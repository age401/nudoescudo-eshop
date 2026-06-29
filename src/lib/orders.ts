import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, orderItems, orders, prices, printings, stock } from "@/db/schema";
import { getPricingContext, getSetting } from "@/lib/settings";
import { computeUnitPriceUsd, round2, usdToUyu } from "@/lib/pricing";
import { orderCode, randomToken } from "@/lib/tokens";

export type OrderRequestItem = { stockId: string; quantity: number };

export type OrderProblem = {
  stockId: string;
  cardName: string;
  available: number;
};

export type CreateOrderResult =
  | { ok: true; orderId: string; publicCode: string; confirmationToken: string }
  | { ok: false; problems: OrderProblem[] };

/**
 * Creates a purchase order and reserves stock atomically.
 *
 * Prices are recomputed server-side from the database — the client's prices
 * are never trusted. Stock rows are locked (FOR UPDATE) so two simultaneous
 * checkouts cannot oversell.
 */
export async function createOrder(args: {
  email: string;
  customerName?: string;
  phone?: string;
  items: OrderRequestItem[];
}): Promise<CreateOrderResult> {
  const items = args.items.filter((i) => i.quantity > 0);
  if (!items.length) return { ok: false, problems: [] };

  const { multiplier, fxRate, minimumUsd } = await getPricingContext();
  const ttlHours = (await getSetting<number>("reservation_ttl_hours")) ?? 24;

  return db.transaction(async (tx) => {
    const ids = items.map((i) => i.stockId);
    const rows = await tx
      .select({
        stock: stock,
        cardName: cards.name,
        setName: printings.setName,
        collectorNumber: printings.collectorNumber,
        imageUris: printings.imageUris,
        printingId: printings.id,
      })
      .from(stock)
      .innerJoin(printings, eq(printings.id, stock.printingId))
      .innerJoin(cards, eq(cards.id, printings.cardId))
      .where(inArray(stock.id, ids))
      .for("update", { of: stock });

    const byId = new Map(rows.map((r) => [r.stock.id, r]));

    // Reference prices for every involved printing+finish, in one query.
    const priceRows = rows.length
      ? await tx
          .select()
          .from(prices)
          .where(inArray(prices.printingId, rows.map((r) => r.printingId)))
      : [];
    const refPrice = new Map(
      priceRows.map((p) => [`${p.printingId}|${p.finish}`, Number(p.priceUsd)]),
    );

    // Validate availability and collect price info.
    const problems: OrderProblem[] = [];
    const lines: {
      row: (typeof rows)[number];
      quantity: number;
      unitPriceUsd: number;
    }[] = [];

    for (const item of items) {
      const row = byId.get(item.stockId);
      if (!row) {
        problems.push({ stockId: item.stockId, cardName: "?", available: 0 });
        continue;
      }
      const available = row.stock.quantity - row.stock.reserved;
      if (available < item.quantity) {
        problems.push({
          stockId: item.stockId,
          cardName: row.cardName,
          available: Math.max(available, 0),
        });
        continue;
      }
      const unit = computeUnitPriceUsd({
        referenceUsd: refPrice.get(`${row.printingId}|${row.stock.finish}`) ?? null,
        overrideUsd: row.stock.priceOverrideUsd
          ? Number(row.stock.priceOverrideUsd)
          : null,
        multiplier,
        minimumUsd,
      });
      if (unit == null) {
        // Not sellable without a price; treat as unavailable.
        problems.push({ stockId: item.stockId, cardName: row.cardName, available: 0 });
        continue;
      }
      lines.push({ row, quantity: item.quantity, unitPriceUsd: unit });
    }

    // Nothing has been written yet, so returning here aborts cleanly.
    if (problems.length) return { ok: false as const, problems };

    const totalUsd = round2(lines.reduce((n, l) => n + l.quantity * l.unitPriceUsd, 0));
    const token = randomToken();
    const code = orderCode();
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

    const [order] = await tx
      .insert(orders)
      .values({
        publicCode: code,
        email: args.email,
        customerName: args.customerName || null,
        phone: args.phone || null,
        confirmationToken: token,
        fxRateUyuPerUsd: fxRate != null ? fxRate.toFixed(4) : null,
        priceMultiplier: multiplier.toFixed(3),
        totalUsd: totalUsd.toFixed(2),
        totalUyu: fxRate != null ? usdToUyu(totalUsd, fxRate).toFixed(2) : null,
        reservationExpiresAt: expiresAt,
      })
      .returning();

    for (const l of lines) {
      await tx.insert(orderItems).values({
        orderId: order.id,
        stockId: l.row.stock.id,
        quantity: l.quantity,
        unitPriceUsd: l.unitPriceUsd.toFixed(2),
        cardName: l.row.cardName,
        setName: l.row.setName,
        collectorNumber: l.row.collectorNumber,
        finish: l.row.stock.finish,
        condition: l.row.stock.condition,
        language: l.row.stock.language,
        imageUrl: l.row.imageUris?.small ?? l.row.imageUris?.normal ?? null,
      });
      await tx
        .update(stock)
        .set({ reserved: sql`${stock.reserved} + ${l.quantity}` })
        .where(eq(stock.id, l.row.stock.id));
    }

    return {
      ok: true as const,
      orderId: order.id,
      publicCode: order.publicCode,
      confirmationToken: token,
    };
  });
}

export type ConfirmResult =
  | { status: "confirmed"; order: typeof orders.$inferSelect }
  | { status: "already_confirmed"; order: typeof orders.$inferSelect }
  | { status: "invalid" };

/** Customer clicked the email link. Idempotent. */
export async function confirmOrder(token: string): Promise<ConfirmResult> {
  if (!token) return { status: "invalid" };
  const order = await db.query.orders.findFirst({
    where: eq(orders.confirmationToken, token),
  });
  if (!order) return { status: "invalid" };
  if (order.status === "confirmed") return { status: "already_confirmed", order };
  if (order.status !== "pending_confirmation") return { status: "invalid" };

  const [updated] = await db
    .update(orders)
    .set({ status: "confirmed", confirmedAt: new Date(), reservationExpiresAt: null })
    .where(eq(orders.id, order.id))
    .returning();
  return { status: "confirmed", order: updated };
}

/** Admin: hand-over done. Decrements physical stock and closes the order. */
export async function completeOrder(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      await tx
        .update(stock)
        .set({
          quantity: sql`greatest(${stock.quantity} - ${item.quantity}, 0)`,
          reserved: sql`greatest(${stock.reserved} - ${item.quantity}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(stock.id, item.stockId));
    }
    await tx
      .update(orders)
      .set({ status: "completed", closedAt: new Date() })
      .where(eq(orders.id, orderId));
  });
}

/** Admin: cancel and release the reservation. */
export async function cancelOrder(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;
    // Only orders that still hold a reservation need to release stock.
    if (order.status === "pending_confirmation" || order.status === "confirmed") {
      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const item of items) {
        await tx
          .update(stock)
          .set({ reserved: sql`greatest(${stock.reserved} - ${item.quantity}, 0)` })
          .where(eq(stock.id, item.stockId));
      }
    }
    await tx
      .update(orders)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(eq(orders.id, orderId));
  });
}
