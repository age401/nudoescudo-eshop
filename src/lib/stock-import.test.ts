/**
 * Integration tests for the stored-preview import workflow. Require the dev
 * database (npm run db:dev). Replace imports act on all MTG stock, like the
 * delver-import tests do.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { stock } from "@/db/schema";
import { Fixtures } from "@/test/fixtures";
import { createOrder } from "./orders";
import {
  REPLACE_PHRASE,
  applyImport,
  canUndo,
  createImportPreview,
  getImport,
  replaceImpact,
  undoImport,
} from "./stock-import";

const fx = new Fixtures();
let a: { printingId: string; externalId: string };
let b: { printingId: string; externalId: string };

function csv(rows: [string, number, string?][]) {
  return [
    "Quantity,Name,Scryfall ID,Foil,Condition,Language",
    ...rows.map(([id, q, foil]) => `${q},X,${id},${foil ?? ""},Near Mint,English`),
  ].join("\n");
}

async function qty(printingId: string, finish = "nonfoil") {
  const [r] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.printingId, printingId), eq(stock.finish, finish)));
  return r?.quantity ?? null;
}

async function preview(text: string, kind: "add" | "replace") {
  const id = await createImportPreview(text, "test.csv", kind);
  fx.trackImport(id);
  return id;
}

beforeAll(async () => {
  [a] = await fx.card({ name: "Import Flow Alpha" });
  [b] = await fx.card({ name: "Import Flow Beta" });
});

afterAll(async () => {
  await fx.cleanup();
  await pool.end();
});

describe("add import", () => {
  it("stores a preview without touching stock, then applies it once", async () => {
    const id = await preview(csv([[a.externalId, 2], [a.externalId, 1], ["not-a-real-id", 4]]), "add");
    const imp = await getImport(id);
    expect(imp?.status).toBe("previewed");
    expect(imp?.rows.lines).toHaveLength(1);
    expect(imp?.rows.lines[0]).toMatchObject({ quantity: 3, cardName: "Import Flow Alpha" });
    expect(imp?.summary).toMatchObject({ copies: 3, unmatchedRows: 1, unmatchedCopies: 4 });
    expect(await qty(a.printingId)).toBeNull();

    await applyImport(id);
    expect(await qty(a.printingId)).toBe(3);
    await expect(applyImport(id)).rejects.toThrow(/ya fue aplicada/);
    expect(await qty(a.printingId)).toBe(3);
  });

  it("undo takes back only copies that are still free", async () => {
    const id = await preview(csv([[b.externalId, 2]]), "add");
    await applyImport(id);
    // One copy gets reserved by a web order before the undo.
    const order = await createOrder({
      email: "undo@test.com",
      phone: "099",
      items: [{ printingId: b.printingId, finish: "nonfoil", language: "en", quantity: 1 }],
    });
    if (!order.ok) throw new Error("order failed");
    fx.trackOrder(order.orderId);

    const res = await undoImport(id);
    expect(res.reversed).toBe(1);
    expect(res.notReversed).toEqual([
      { label: "Import Flow Beta (Test Set)", wanted: 2, done: 1 },
    ]);
    expect(await qty(b.printingId)).toBe(1);
    expect((await getImport(id))?.status).toBe("undone");
  });
});

describe("replace import", () => {
  it("requires the exact phrase", async () => {
    const id = await preview(csv([[a.externalId, 1]]), "replace");
    await expect(applyImport(id, "reemplazar")).rejects.toThrow(REPLACE_PHRASE);
    expect((await getImport(id))?.status).toBe("previewed");
  });

  it("reports its impact, applies, and undo restores removed rows", async () => {
    // Stock now: Alpha 3, Beta 1 (reserved 1). File: Alpha 1, Alpha foil 2.
    const id = await preview(csv([[a.externalId, 1], [a.externalId, 2, "Foil"]]), "replace");
    const imp = (await getImport(id))!;
    const impact = await replaceImpact(imp.rows.lines);
    expect(impact.newVariants).toBeGreaterThanOrEqual(1);
    expect(impact.heldByReservations).toBeGreaterThanOrEqual(1);
    expect(impact.losses.find((l) => l.cardName === "Import Flow Alpha")).toMatchObject({ now: 3, after: 1 });

    await applyImport(id, REPLACE_PHRASE);
    expect(await qty(a.printingId)).toBe(1);
    expect(await qty(a.printingId, "foil")).toBe(2);
    expect(await qty(b.printingId)).toBe(1); // held by its reservation

    expect(await canUndo((await getImport(id))!)).toBe(true);
    await undoImport(id);
    expect(await qty(a.printingId)).toBe(3);
    expect(await qty(a.printingId, "foil")).toBe(0);
  });

  it("only the latest applied import can be undone", async () => {
    const first = await preview(csv([[a.externalId, 1]]), "add");
    await applyImport(first);
    const second = await preview(csv([[a.externalId, 1]]), "add");
    await applyImport(second);
    expect(await canUndo((await getImport(first))!)).toBe(false);
    await expect(undoImport(first)).rejects.toThrow(/última/);
    expect(await canUndo((await getImport(second))!)).toBe(true);
  });
});
