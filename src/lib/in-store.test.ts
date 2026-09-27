/**
 * Integration tests for counter sales. Require the dev database
 * (npm run db:dev).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { orders, stock, stockMovements } from "@/db/schema";
import { Fixtures } from "@/test/fixtures";
import { buildSaleDraft, confirmSale, voidCompletedOrder } from "./in-store";
import { createOrder } from "./orders";

const fx = new Fixtures();
type P = { printingId: string; externalId: string };
let unlimited: P, fourth: P, bolt: P, ghost: P;
let fourthStockId: string, boltNm: string, boltLp: string, ghostStockId: string;

function scan(rows: [string, number, string?, string?][]) {
  return [
    "Quantity,Name,Scryfall ID,Foil,Condition,Language",
    ...rows.map(([id, q, name, foil]) => `${q},"${name ?? "X"}",${id},${foil ?? ""},Near Mint,English`),
  ].join("\n");
}

async function qty(id: string) {
  const [r] = await db.select().from(stock).where(eq(stock.id, id));
  return r.quantity;
}

beforeAll(async () => {
  // Serra: we stock only the 4th Edition printing; Delver reads Unlimited.
  [unlimited, fourth] = await fx.card({
    name: "Serra Angel Test",
    sets: [
      { code: "2ed", name: "Unlimited Edition" },
      { code: "4ed", name: "Fourth Edition", priceUsd: "2.00" },
    ],
  });
  fourthStockId = (await fx.stock(fourth.printingId, 1)).id;
  // Bolt: 1 NM + 2 LP of the same printing.
  [bolt] = await fx.card({ name: "Bolt Test", sets: [{ code: "m10", name: "Magic 2010", priceUsd: "1.00" }] });
  boltNm = (await fx.stock(bolt.printingId, 1)).id;
  boltLp = (await fx.stock(bolt.printingId, 2, { condition: "LP" })).id;
  // Ghost: all copies reserved by a web order.
  [ghost] = await fx.card({ name: "Ghost Test", sets: [{ code: "gho", name: "Ghost Set" }] });
  ghostStockId = (await fx.stock(ghost.printingId, 1)).id;
  const order = await createOrder({
    email: "ghost@test.com",
    phone: "099",
    items: [{ printingId: ghost.printingId, finish: "nonfoil", language: "en", quantity: 1 }],
  });
  if (!order.ok) throw new Error("order failed");
  fx.trackOrder(order.orderId);
});

afterAll(async () => {
  await fx.cleanup();
  await pool.end();
});

describe("buildSaleDraft", () => {
  it("suggests the stocked edition when Delver read another one", async () => {
    const d = await buildSaleDraft(scan([[unlimited.externalId, 1, "Serra Angel Test"]]));
    expect(d.lines).toHaveLength(0);
    expect(d.problems).toHaveLength(1);
    const p = d.problems[0];
    expect(p.reason).toBe("no_stock");
    expect(p.readAs?.setName).toBe("Unlimited Edition");
    expect(p.suggestions.map((s) => s.stockId)).toEqual([fourthStockId]);
    expect(p.suggestions[0]).toMatchObject({ setName: "Fourth Edition", unitPriceUsd: 2 });
  });

  it("allocates exact matches best condition first, across rows", async () => {
    const d = await buildSaleDraft(scan([[bolt.externalId, 1], [bolt.externalId, 1], [bolt.externalId, 1]]));
    expect(d.scannedCopies).toBe(3);
    expect(d.problems).toHaveLength(0);
    expect(d.lines.map((l) => [l.candidate.stockId, l.quantity])).toEqual([
      [boltNm, 1],
      [boltLp, 2],
    ]);
  });

  it("reports a shortfall when there aren't enough copies", async () => {
    const d = await buildSaleDraft(scan([[bolt.externalId, 5]]));
    expect(d.lines.reduce((n, l) => n + l.quantity, 0)).toBe(3);
    expect(d.problems[0]).toMatchObject({ reason: "short", missing: 2 });
  });

  it("explains copies held by a web order", async () => {
    const d = await buildSaleDraft(scan([[ghost.externalId, 1]]));
    expect(d.problems[0].reason).toBe("reserved");
    expect(d.problems[0].reservedBy).toHaveLength(1);
  });

  it("falls back to the card name when the printing isn't in the catalog", async () => {
    const d = await buildSaleDraft(scan([["not-in-catalog", 1, "Serra Angel Test"]]));
    expect(d.problems[0].reason).toBe("unknown_printing");
    expect(d.problems[0].suggestions.map((s) => s.stockId)).toEqual([fourthStockId]);
  });
});

describe("confirmSale", () => {
  it("records a completed in-store order, once", async () => {
    const requestId = crypto.randomUUID();
    const input = {
      requestId,
      customerName: "Mostrador",
      lines: [{ stockId: fourthStockId, quantity: 1, unitPriceUsd: 1.5 }],
    };
    const res = await confirmSale(input);
    if (!res.ok) throw new Error(res.message);
    fx.trackOrder(res.orderId);
    const again = await confirmSale(input);
    expect(again).toEqual(res);

    const [order] = await db.select().from(orders).where(eq(orders.id, res.orderId));
    expect(order).toMatchObject({ channel: "in_store", status: "completed", totalUsd: "1.50", email: null });
    expect(await qty(fourthStockId)).toBe(0);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.orderId, res.orderId));
    expect(moves.map((m) => [m.reason, m.delta])).toEqual([["in_store_sale", -1]]);
  });

  it("refuses when stock ran out in the meantime, writing nothing", async () => {
    const res = await confirmSale({
      requestId: crypto.randomUUID(),
      lines: [{ stockId: ghostStockId, quantity: 1, unitPriceUsd: 1 }],
    });
    expect(res.ok).toBe(false);
    expect(await qty(ghostStockId)).toBe(1);
  });

  it("voiding a sale puts the copies back", async () => {
    const res = await confirmSale({
      requestId: crypto.randomUUID(),
      lines: [{ stockId: boltLp, quantity: 2, unitPriceUsd: 1 }],
    });
    if (!res.ok) throw new Error(res.message);
    fx.trackOrder(res.orderId);
    expect(await qty(boltLp)).toBe(0);
    expect(await voidCompletedOrder(res.orderId, "se equivocó de carta")).toBe(true);
    expect(await voidCompletedOrder(res.orderId)).toBe(false);
    expect(await qty(boltLp)).toBe(2);
    const [order] = await db.select().from(orders).where(eq(orders.id, res.orderId));
    expect(order.status).toBe("cancelled");
  });
});
