/**
 * Integration tests for the Delver Lens import. Require the dev database
 * (npm run db:dev). Each test builds its own isolated fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { cards, orderItems, orders, prices, printings, stock } from "@/db/schema";
import { completeOrder, confirmOrder, createOrder } from "./orders";
import { applyDelverImport, parseDelverCsv } from "./delver-import";
import { pendingDelverCopies, pendingDelverLines } from "./delver-report";

/** A Delver export listing `ids`, one copy each. */
function csvFor(ids: string[]): string {
  return [
    "Quantity,Card Name,Scryfall Id,Foil/Etched,Condition,Language",
    ...ids.map((id) => `1,Test Card,${id},,NM,English`),
  ].join("\n");
}

// mtgSold is sold via an order; mtgKept stays in the Delver file.
let mtgSoldExt: string, mtgKeptExt: string, pokeExt: string;
let mtgSoldStockId: string, mtgKeptStockId: string, pokeStockId: string;
const printingIds: string[] = [];
const cardIds: string[] = [];
const createdOrders: string[] = [];

async function makeCard(gameId: string, externalId: string, qty: number) {
  const [card] = await db
    .insert(cards)
    .values({
      gameId,
      externalGroupId: externalId,
      name: `Import Test ${externalId.slice(0, 8)}`,
      normalizedName: `import test ${externalId.slice(0, 8)}`,
      slug: externalId,
    })
    .returning();
  cardIds.push(card.id);
  const [printing] = await db
    .insert(printings)
    .values({
      cardId: card.id,
      externalId,
      setCode: "tst",
      setName: "Import Test Set",
      collectorNumber: "1",
      finishes: ["nonfoil"],
    })
    .returning();
  printingIds.push(printing.id);
  await db.insert(prices).values({
    printingId: printing.id,
    finish: "nonfoil",
    source: "cardkingdom",
    priceUsd: "5.00",
  });
  const [s] = await db
    .insert(stock)
    .values({
      printingId: printing.id,
      finish: "nonfoil",
      condition: "NM",
      language: "en",
      quantity: qty,
    })
    .returning();
  return s.id;
}

beforeAll(async () => {
  mtgSoldExt = crypto.randomUUID();
  mtgKeptExt = crypto.randomUUID();
  pokeExt = `tcgdex:test-${crypto.randomUUID()}`;
  mtgSoldStockId = await makeCard("mtg", mtgSoldExt, 1);
  mtgKeptStockId = await makeCard("mtg", mtgKeptExt, 2);
  pokeStockId = await makeCard("pokemon", pokeExt, 4);
});

afterAll(async () => {
  for (const id of createdOrders) {
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    await db.delete(orders).where(eq(orders.id, id));
  }
  for (const id of printingIds) {
    await db.delete(stock).where(eq(stock.printingId, id));
    await db.delete(prices).where(eq(prices.printingId, id));
    await db.delete(printings).where(eq(printings.id, id));
  }
  for (const id of cardIds) await db.delete(cards).where(eq(cards.id, id));
  await pool.end();
});

async function getStock(id: string) {
  const [s] = await db.select().from(stock).where(eq(stock.id, id));
  return s ?? null;
}

describe("parseDelverCsv", () => {
  it("accepts fields with embedded quotes that Delver leaves unwrapped", () => {
    // Delver emits artist nicknames like this without an outer quote pair.
    const csv =
      "Quantity,Scryfall Id,Artist,Condition\n" +
      `1,${mtgKeptExt},Josiah ""Jo"" Cameron,NM\n`;
    const rows = parseDelverCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].scryfallId).toBe(mtgKeptExt);
  });

  it("rejects a file without a Scryfall ID column", () => {
    expect(() => parseDelverCsv("Quantity,Card Name\n1,Foo\n")).toThrow();
  });

  it("respects a genuine Quantity of 0 instead of defaulting to 1", () => {
    // Delver uses 0 to mean "tracked, but I own none". parseInt("0") || 1
    // used to silently turn that into 1 — regression coverage for that bug.
    const csv = `Quantity,Scryfall Id\n0,${mtgKeptExt}\n`;
    const rows = parseDelverCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(0);
  });

  it("still defaults to 1 when the quantity cell is blank or missing", () => {
    const csv = `Quantity,Scryfall Id\n,${mtgKeptExt}\n`;
    expect(parseDelverCsv(csv)[0].quantity).toBe(1);
    expect(parseDelverCsv(`Scryfall Id\n${mtgKeptExt}\n`)[0].quantity).toBe(1);
  });
});

describe("applyDelverImport (replace)", () => {
  it("does not crash when a sold-out card is still referenced by an order", async () => {
    const r = await createOrder({
      email: "import@test.com",
      items: [{ stockId: mtgSoldStockId, quantity: 1 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);
    await confirmOrder(r.confirmationToken);
    await completeOrder(r.orderId);
    expect((await getStock(mtgSoldStockId))?.quantity).toBe(0);

    // The admin pulled the sold card from Delver, so it's absent from the file.
    await expect(
      applyDelverImport(csvFor([mtgKeptExt]), "replace"),
    ).resolves.toBeTruthy();

    // Kept at quantity 0 rather than deleted, so order history survives.
    expect((await getStock(mtgSoldStockId))?.quantity).toBe(0);
    const [item] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, r.orderId));
    expect(item.stockId).toBe(mtgSoldStockId);
  });

  it("overwrites MTG quantities from the file", async () => {
    await applyDelverImport(csvFor([mtgKeptExt, mtgKeptExt]), "replace");
    expect((await getStock(mtgKeptStockId))?.quantity).toBe(2);

    await applyDelverImport(csvFor([mtgKeptExt]), "replace");
    expect((await getStock(mtgKeptStockId))?.quantity).toBe(1);
  });

  it("leaves non-MTG stock untouched (Delver never exports Pokemon)", async () => {
    const before = (await getStock(pokeStockId))?.quantity;
    expect(before).toBeGreaterThan(0);
    await applyDelverImport(csvFor([mtgKeptExt]), "replace");
    const poke = await getStock(pokeStockId);
    // Neither zeroed nor swept up by the cleanup delete.
    expect(poke).not.toBeNull();
    expect(poke?.quantity).toBe(before);
  });
});

describe("pending Delver report", () => {
  it("lists the sold MTG card and ignores sold Pokemon", async () => {
    // Sell a Pokemon card too; Delver never tracks it, so it must not appear.
    const r = await createOrder({
      email: "poke@test.com",
      items: [{ stockId: pokeStockId, quantity: 1 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);
    await confirmOrder(r.confirmationToken);
    await completeOrder(r.orderId);

    const lines = await pendingDelverLines();
    const names = lines.map((l) => l.card_name);
    // The MTG card sold in the FK test above is still unreconciled.
    expect(names).toContain(`Import Test ${mtgSoldExt.slice(0, 8)}`);
    expect(names).not.toContain(`Import Test ${pokeExt.slice(0, 8)}`);
  });

  it("counts only Delver-tracked copies", async () => {
    const copies = await pendingDelverCopies();
    const lines = await pendingDelverLines();
    expect(copies).toBe(lines.reduce((n, l) => n + l.qty, 0));
  });

  it("drops an order from the report once marked removed", async () => {
    const before = await pendingDelverCopies();
    expect(before).toBeGreaterThan(0);
    await db
      .update(orders)
      .set({ delverRemovedAt: new Date() })
      .where(eq(orders.status, "completed"));
    expect(await pendingDelverCopies()).toBe(0);
    // Undo, so the suite leaves no surprises for a re-run.
    await db
      .update(orders)
      .set({ delverRemovedAt: null })
      .where(eq(orders.status, "completed"));
    expect(await pendingDelverCopies()).toBe(before);
  });
});

describe("applyDelverImport (merge)", () => {
  it("adds to existing quantities", async () => {
    const before = (await getStock(mtgKeptStockId))?.quantity ?? 0;
    await applyDelverImport(csvFor([mtgKeptExt]), "merge");
    expect((await getStock(mtgKeptStockId))?.quantity).toBe(before + 1);
  });

  it("does not touch other games", async () => {
    const before = (await getStock(pokeStockId))?.quantity;
    await applyDelverImport(csvFor([mtgKeptExt]), "merge");
    expect((await getStock(pokeStockId))?.quantity).toBe(before);
  });
});
