/**
 * Integration tests for the reservation engine. Require the dev database
 * (npm run db:dev). Each test builds its own isolated fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { cards, games, orderItems, orders, prices, printings, stock } from "@/db/schema";
import { cancelOrder, completeOrder, confirmOrder, createOrder } from "./orders";
import { expireStaleOrders } from "@/jobs/order-expiry";

let stockId: string;
let lpStockId = "";
let printingId: string;
let cardId: string;
const createdOrders: string[] = [];

beforeAll(async () => {
  const ext = `test-${crypto.randomUUID()}`;
  const [card] = await db
    .insert(cards)
    .values({
      gameId: "mtg",
      externalGroupId: ext,
      name: "Test Reservation Card",
      normalizedName: "test reservation card",
      slug: ext,
    })
    .returning();
  cardId = card.id;
  const [printing] = await db
    .insert(printings)
    .values({
      cardId,
      externalId: ext,
      setCode: "tst",
      setName: "Test Set",
      collectorNumber: "1",
      finishes: ["nonfoil"],
    })
    .returning();
  printingId = printing.id;
  await db.insert(prices).values({
    printingId,
    finish: "nonfoil",
    source: "cardkingdom",
    priceUsd: "10.00",
  });
  const [s] = await db
    .insert(stock)
    .values({ printingId, finish: "nonfoil", condition: "NM", language: "en", quantity: 3 })
    .returning();
  stockId = s.id;
});

/** Orders address a pool (printing + finish + language), never a stock row. */
function poolItem(quantity: number) {
  return { printingId, finish: "nonfoil", language: "en", quantity };
}

afterAll(async () => {
  for (const id of createdOrders) {
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    await db.delete(orders).where(eq(orders.id, id));
  }
  await db.delete(stock).where(eq(stock.printingId, printingId));
  await db.delete(prices).where(eq(prices.printingId, printingId));
  await db.delete(printings).where(eq(printings.id, printingId));
  await db.delete(cards).where(eq(cards.id, cardId));
  await pool.end();
});

async function getStock() {
  const [s] = await db.select().from(stock).where(eq(stock.id, stockId));
  return s;
}

describe("createOrder", () => {
  it("reserves stock and snapshots prices", async () => {
    const r = await createOrder({
      email: "a@test.com",
      phone: "099111222",
      items: [poolItem(2)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);
    expect((await getStock()).reserved).toBe(2);

    const [order] = await db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(Number(order.totalUsd)).toBeCloseTo(20);
    expect(order.status).toBe("pending_confirmation");
  });

  it("rejects when requesting more than available", async () => {
    // 3 total, 2 reserved -> only 1 available.
    const r = await createOrder({
      email: "b@test.com",
      phone: "099111222",
      items: [poolItem(2)],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0].available).toBe(1);
    expect((await getStock()).reserved).toBe(2); // unchanged
  });

  it("prevents oversell under concurrency", async () => {
    // 1 available; two simultaneous orders of 1 -> exactly one succeeds.
    const [r1, r2] = await Promise.all([
      createOrder({ email: "c1@test.com", phone: "099111222", items: [poolItem(1)] }),
      createOrder({ email: "c2@test.com", phone: "099111222", items: [poolItem(1)] }),
    ]);
    const succeeded = [r1, r2].filter((r) => r.ok);
    expect(succeeded.length).toBe(1);
    for (const r of [r1, r2]) if (r.ok) createdOrders.push(r.orderId);
    expect((await getStock()).reserved).toBe(3);
  });
});

describe("lifecycle", () => {
  it("expiry releases unconfirmed reservations", async () => {
    // Force the first (still pending) orders to be expired.
    await db
      .update(orders)
      .set({ reservationExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.status, "pending_confirmation"));
    await expireStaleOrders();
    const s = await getStock();
    expect(s.reserved).toBe(0);
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.status, "expired"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("confirm + complete decrements physical stock", async () => {
    const r = await createOrder({
      email: "d@test.com",
      phone: "099111222",
      items: [poolItem(1)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);

    const confirmed = await confirmOrder(r.confirmationToken);
    expect(confirmed.status).toBe("confirmed");
    // Re-confirming is idempotent.
    expect((await confirmOrder(r.confirmationToken)).status).toBe("already_confirmed");

    await completeOrder(r.orderId);
    const s = await getStock();
    expect(s.quantity).toBe(2);
    expect(s.reserved).toBe(0);
  });

  it("cancel releases the reservation without touching quantity", async () => {
    const r = await createOrder({
      email: "e@test.com",
      phone: "099111222",
      items: [poolItem(1)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);
    expect((await getStock()).reserved).toBe(1);

    await cancelOrder(r.orderId);
    const s = await getStock();
    expect(s.reserved).toBe(0);
    expect(s.quantity).toBe(2);
  });
});

describe("condition pooling", () => {
  /** Puts the pool's two grades in a known state before each case. */
  async function setGrades(args: {
    nm: { quantity: number; reserved: number; price: string };
    lp: { quantity: number; reserved: number; price: string };
  }) {
    await db
      .update(stock)
      .set({
        quantity: args.nm.quantity,
        reserved: args.nm.reserved,
        priceOverrideUsd: args.nm.price,
      })
      .where(eq(stock.id, stockId));
    const values = {
      printingId,
      finish: "nonfoil",
      condition: "LP",
      language: "en",
      quantity: args.lp.quantity,
      reserved: args.lp.reserved,
      priceOverrideUsd: args.lp.price,
    };
    if (lpStockId) {
      await db.update(stock).set(values).where(eq(stock.id, lpStockId));
    } else {
      const [lp] = await db.insert(stock).values(values).returning();
      lpStockId = lp.id;
    }
  }

  it("fills a pool from the best grade down and never overcharges", async () => {
    await setGrades({
      nm: { quantity: 2, reserved: 0, price: "12.00" },
      lp: { quantity: 2, reserved: 0, price: "7.00" },
    });

    const r = await createOrder({
      email: "pool@test.com",
      phone: "099111222",
      items: [poolItem(3)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);

    const lines = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, r.orderId));
    const byStock = new Map(lines.map((l) => [l.stockId, l]));
    // Both NM copies first, then one LP.
    expect(byStock.get(stockId)?.quantity).toBe(2);
    expect(byStock.get(lpStockId)?.quantity).toBe(1);
    // The LP copy is cheaper, so it is billed at its own lower price.
    expect(Number(byStock.get(stockId)!.unitPriceUsd)).toBeCloseTo(12);
    expect(Number(byStock.get(lpStockId)!.unitPriceUsd)).toBeCloseTo(7);

    const [order] = await db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(Number(order.totalUsd)).toBeCloseTo(31); // 12 + 12 + 7
  });

  it("caps a worse grade at the price the pool was shown for", async () => {
    // A dearer LP copy must not be billed above the NM price the storefront
    // quoted for the pool.
    await setGrades({
      nm: { quantity: 1, reserved: 0, price: "12.00" },
      lp: { quantity: 2, reserved: 0, price: "99.00" },
    });

    const r = await createOrder({
      email: "cap@test.com",
      phone: "099111222",
      items: [poolItem(2)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrders.push(r.orderId);

    const lines = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, r.orderId));
    const byStock = new Map(lines.map((l) => [l.stockId, l]));
    expect(Number(byStock.get(stockId)!.unitPriceUsd)).toBeCloseTo(12);
    expect(Number(byStock.get(lpStockId)!.unitPriceUsd)).toBeCloseTo(12); // not 99
  });

  it("reports availability across every grade in the pool", async () => {
    await setGrades({
      nm: { quantity: 2, reserved: 1, price: "12.00" },
      lp: { quantity: 3, reserved: 1, price: "7.00" },
    });

    const r = await createOrder({
      email: "avail@test.com",
      phone: "099111222",
      items: [poolItem(99)],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 1 sellable NM + 2 sellable LP.
    expect(r.problems[0].available).toBe(3);
    expect(r.problems[0].poolKey).toContain(printingId);
  });
});

describe("disabled games", () => {
  it("refuses stock from a game that is not on sale", async () => {
    await db.update(games).set({ enabled: false }).where(eq(games.id, "mtg"));
    try {
      const r = await createOrder({
        email: "disabled@test.com",
        phone: "099111222",
        items: [poolItem(1)],
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.problems[0].available).toBe(0);
    } finally {
      await db.update(games).set({ enabled: true }).where(eq(games.id, "mtg"));
    }
  });
});

describe("sanity", () => {
  it("test stock row exists with expected shape", async () => {
    const s = await getStock();
    expect(s.printingId).toBe(printingId);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stock)
      .where(eq(stock.printingId, printingId));
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
