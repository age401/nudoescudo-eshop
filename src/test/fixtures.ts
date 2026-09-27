/**
 * Throwaway catalog/stock fixtures for DB-backed tests (need `npm run db:dev`).
 * Everything created through a Fixtures instance is removed by cleanup(),
 * children first, so a test file leaves the dev database as it found it.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  cards,
  orderItems,
  orders,
  prices,
  printings,
  stock,
  stockImports,
  stockMovements,
} from "@/db/schema";

export class Fixtures {
  cardIds: string[] = [];
  printingIds: string[] = [];
  orderIds: string[] = [];
  importIds: string[] = [];

  /** A card with one printing per entry of `sets`. Returns printing ids in order. */
  async card(opts: {
    name: string;
    gameId?: string;
    sets?: { code: string; name: string; finishes?: string[]; priceUsd?: string }[];
  }) {
    const ext = `test-${crypto.randomUUID()}`;
    const [card] = await db
      .insert(cards)
      .values({
        gameId: opts.gameId ?? "mtg",
        externalGroupId: ext,
        name: opts.name,
        normalizedName: opts.name.toLowerCase(),
        slug: ext,
      })
      .returning();
    this.cardIds.push(card.id);
    const sets = opts.sets ?? [{ code: "tst", name: "Test Set" }];
    const result: { cardId: string; printingId: string; externalId: string }[] = [];
    for (const [i, s] of sets.entries()) {
      const externalId = `${ext}-${i}`;
      const [p] = await db
        .insert(printings)
        .values({
          cardId: card.id,
          externalId,
          setCode: s.code,
          setName: s.name,
          collectorNumber: String(i + 1),
          finishes: s.finishes ?? ["nonfoil", "foil"],
        })
        .returning();
      this.printingIds.push(p.id);
      await db.insert(prices).values({
        printingId: p.id,
        finish: "nonfoil",
        source: "cardkingdom",
        priceUsd: s.priceUsd ?? "10.00",
      });
      result.push({ cardId: card.id, printingId: p.id, externalId });
    }
    return result;
  }

  async stock(
    printingId: string,
    quantity: number,
    v: { finish?: string; condition?: string; language?: string; reserved?: number } = {},
  ) {
    const [row] = await db
      .insert(stock)
      .values({
        printingId,
        finish: v.finish ?? "nonfoil",
        condition: v.condition ?? "NM",
        language: v.language ?? "en",
        quantity,
        reserved: v.reserved ?? 0,
      })
      .returning();
    return row;
  }

  trackOrder(id: string) {
    this.orderIds.push(id);
  }

  trackImport(id: string) {
    this.importIds.push(id);
  }

  async cleanup() {
    if (this.printingIds.length) {
      await db.delete(stockMovements).where(inArray(stockMovements.printingId, this.printingIds));
    }
    if (this.orderIds.length) {
      await db.delete(stockMovements).where(inArray(stockMovements.orderId, this.orderIds));
      await db.delete(orderItems).where(inArray(orderItems.orderId, this.orderIds));
      await db.delete(orders).where(inArray(orders.id, this.orderIds));
    }
    if (this.importIds.length) {
      await db.delete(stockImports).where(inArray(stockImports.id, this.importIds));
    }
    for (const id of this.printingIds) {
      await db.delete(stock).where(eq(stock.printingId, id));
      await db.delete(prices).where(eq(prices.printingId, id));
      await db.delete(printings).where(eq(printings.id, id));
    }
    if (this.cardIds.length) await db.delete(cards).where(inArray(cards.id, this.cardIds));
  }
}
