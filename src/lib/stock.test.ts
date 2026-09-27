/**
 * Integration tests for the stock ledger. Require the dev database
 * (npm run db:dev).
 */
import { afterAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { stock, stockMovements } from "@/db/schema";
import { Fixtures } from "@/test/fixtures";
import { completeOrder, confirmOrder, createOrder } from "./orders";
import {
  StockError,
  addStockCopies,
  applyStockDelta,
  deleteEmptyStockRow,
  setStockQuantity,
} from "./stock";

const fx = new Fixtures();

afterAll(async () => {
  await fx.cleanup();
  await pool.end();
});

async function movementsOf(stockId: string) {
  return db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.stockId, stockId))
    .orderBy(asc(stockMovements.createdAt));
}

async function rowOf(stockId: string) {
  const [r] = await db.select().from(stock).where(eq(stock.id, stockId));
  return r;
}

describe("stock ledger", () => {
  it("records every change with the quantity after it", async () => {
    const [{ printingId }] = await fx.card({ name: "Ledger Test A" });
    const variant = { printingId, finish: "nonfoil", condition: "NM", language: "en" };
    const { stockId } = await db.transaction((tx) =>
      addStockCopies(tx, variant, 3, { reason: "manual_add" }),
    );
    await db.transaction((tx) => addStockCopies(tx, variant, 2, { reason: "import_add" }));
    await db.transaction((tx) =>
      setStockQuantity(tx, stockId, 4, 5, { reason: "manual_adjust", note: "conteo" }),
    );

    const moves = await movementsOf(stockId);
    expect(moves.map((m) => [m.reason, m.delta, m.quantityAfter])).toEqual([
      ["manual_add", 3, 3],
      ["import_add", 2, 5],
      ["manual_adjust", -1, 4],
    ]);
    expect(moves[2].note).toBe("conteo");
    expect((await rowOf(stockId)).quantity).toBe(4);
  });

  it("refuses an edit made on a stale quantity", async () => {
    const [{ printingId }] = await fx.card({ name: "Ledger Test B" });
    const row = await fx.stock(printingId, 5);
    await expect(
      db.transaction((tx) => setStockQuantity(tx, row.id, 1, 3, { reason: "manual_adjust" })),
    ).rejects.toMatchObject({ code: "stale" });
    expect((await rowOf(row.id)).quantity).toBe(5);
  });

  it("never lets quantity drop below what web orders reserved", async () => {
    const [{ printingId }] = await fx.card({ name: "Ledger Test C" });
    const row = await fx.stock(printingId, 3, { reserved: 2 });
    await expect(
      db.transaction((tx) => setStockQuantity(tx, row.id, 1, 3, { reason: "manual_adjust" })),
    ).rejects.toBeInstanceOf(StockError);
    await expect(
      db.transaction((tx) => applyStockDelta(tx, row.id, -2, { reason: "in_store_sale" })),
    ).rejects.toMatchObject({ code: "below_reserved" });
    // Imports clamp instead of failing.
    const r = await db.transaction((tx) =>
      setStockQuantity(tx, row.id, 0, null, { reason: "import_replace" }, { clampToReserved: true }),
    );
    expect(r.quantityAfter).toBe(2);
  });

  it("completing a web order writes one movement and is idempotent", async () => {
    const [{ printingId }] = await fx.card({ name: "Ledger Test D" });
    const row = await fx.stock(printingId, 4);
    const res = await createOrder({
      email: "ledger@test.com",
      phone: "099",
      items: [{ printingId, finish: "nonfoil", language: "en", quantity: 3 }],
    });
    if (!res.ok) throw new Error("order failed");
    fx.trackOrder(res.orderId);
    await confirmOrder(res.confirmationToken);
    await completeOrder(res.orderId);
    await completeOrder(res.orderId); // double submit

    const after = await rowOf(row.id);
    expect([after.quantity, after.reserved]).toEqual([1, 0]);
    const moves = await movementsOf(row.id);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ reason: "web_order", delta: -3, orderId: res.orderId });
  });

  it("deletes only empty, never-sold rows and keeps their history", async () => {
    const [{ printingId }] = await fx.card({ name: "Ledger Test E" });
    const variant = { printingId, finish: "foil", condition: "LP", language: "es" };
    const { stockId } = await db.transaction((tx) =>
      addStockCopies(tx, variant, 1, { reason: "manual_add" }),
    );
    expect(await db.transaction((tx) => deleteEmptyStockRow(tx, stockId))).toBe(false);
    await db.transaction((tx) => applyStockDelta(tx, stockId, -1, { reason: "manual_adjust" }));
    expect(await db.transaction((tx) => deleteEmptyStockRow(tx, stockId))).toBe(true);
    const orphaned = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.printingId, printingId));
    expect(orphaned).toHaveLength(2);
    expect(orphaned.every((m) => m.stockId === null)).toBe(true);
  });
});
