/**
 * Releases reservations for orders whose confirmation link was never clicked.
 * Runs every 15 minutes from the worker.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, stock } from "@/db/schema";
import { withSyncRun } from "@/lib/sync-runs";

export async function expireStaleOrders() {
  return withSyncRun("order_expiry", async () => {
    const expired = await db.transaction(async (tx) => {
      const stale = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.status, "pending_confirmation"),
            lt(orders.reservationExpiresAt, new Date()),
          ),
        )
        .for("update");
      if (!stale.length) return 0;

      for (const { id } of stale) {
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, id));
        for (const item of items) {
          await tx
            .update(stock)
            .set({ reserved: sql`greatest(${stock.reserved} - ${item.quantity}, 0)` })
            .where(eq(stock.id, item.stockId));
        }
        await tx
          .update(orders)
          .set({ status: "expired", closedAt: new Date() })
          .where(eq(orders.id, id));
      }
      return stale.length;
    });
    return { expired };
  });
}
