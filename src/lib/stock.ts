/**
 * The only place that changes stock.quantity.
 *
 * Every change is written together with a stock_movements row in the caller's
 * transaction, so the ledger always adds up to what is on the shelf. Two
 * invariants are enforced here rather than trusted to callers:
 *  - quantity never goes below 0;
 *  - quantity never goes below reserved (copies promised to web orders),
 *    except when the same call releases that reservation (an order handover).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { stock, stockMovements } from "@/db/schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MovementReason = (typeof stockMovements.$inferInsert)["reason"];

export type MovementMeta = {
  reason: MovementReason;
  importId?: string | null;
  orderId?: string | null;
  note?: string | null;
};

export type Variant = {
  printingId: string;
  finish: string;
  condition: string;
  language: string;
};

export type StockErrorCode = "not_found" | "below_reserved" | "negative" | "stale";

/** A rejected change. `message` is operator-facing (Spanish). */
export class StockError extends Error {
  constructor(
    public code: StockErrorCode,
    message: string,
    public details: { stockId?: string; quantity?: number; reserved?: number } = {},
  ) {
    super(message);
    this.name = "StockError";
  }
}

async function lockRow(tx: Tx, stockId: string) {
  const [row] = await tx.select().from(stock).where(eq(stock.id, stockId)).for("update");
  if (!row) throw new StockError("not_found", "Esa fila de stock ya no existe.", { stockId });
  return row;
}

async function record(
  tx: Tx,
  row: typeof stock.$inferSelect,
  delta: number,
  quantityAfter: number,
  meta: MovementMeta,
) {
  if (delta === 0) return;
  await tx.insert(stockMovements).values({
    stockId: row.id,
    printingId: row.printingId,
    finish: row.finish,
    condition: row.condition,
    language: row.language,
    delta,
    quantityAfter,
    reason: meta.reason,
    importId: meta.importId ?? null,
    orderId: meta.orderId ?? null,
    note: meta.note?.trim() || null,
  });
}

/**
 * Adds `delta` (may be negative) to a stock row.
 *
 * @param releaseReserved copies of this change that were reserved and are now
 *   leaving the shop with their order: reserved drops by this much too.
 * @param clampAtZero take only what is there instead of failing.
 */
export async function applyStockDelta(
  tx: Tx,
  stockId: string,
  delta: number,
  meta: MovementMeta,
  opts: { releaseReserved?: number; clampAtZero?: boolean } = {},
): Promise<{ quantityAfter: number; reservedAfter: number }> {
  const row = await lockRow(tx, stockId);
  const release = Math.min(opts.releaseReserved ?? 0, row.reserved);
  // A handover already happened physically; recording it must not fail on
  // stock that was inconsistent to begin with (e.g. legacy replace-imports).
  if (opts.clampAtZero && row.quantity + delta < 0) delta = -row.quantity;
  const quantityAfter = row.quantity + delta;
  const reservedAfter = row.reserved - release;
  if (quantityAfter < 0) {
    throw new StockError(
      "negative",
      `No hay suficientes copias (hay ${row.quantity}).`,
      { stockId, quantity: row.quantity, reserved: row.reserved },
    );
  }
  if (quantityAfter < reservedAfter) {
    throw new StockError(
      "below_reserved",
      `${reservedAfter} ${reservedAfter === 1 ? "copia está reservada" : "copias están reservadas"} para pedidos web; no se puede bajar de ahí.`,
      { stockId, quantity: row.quantity, reserved: row.reserved },
    );
  }
  await tx
    .update(stock)
    .set({ quantity: quantityAfter, reserved: reservedAfter, updatedAt: new Date() })
    .where(eq(stock.id, stockId));
  await record(tx, row, delta, quantityAfter, meta);
  return { quantityAfter, reservedAfter };
}

/**
 * Sets an absolute quantity, as typed by the admin.
 *
 * @param expected the quantity the admin was looking at. If the row changed
 *   since (a sale, an import), the save is refused instead of silently
 *   overwriting it. Pass null to skip the check (imports).
 */
export async function setStockQuantity(
  tx: Tx,
  stockId: string,
  quantity: number,
  expected: number | null,
  meta: MovementMeta,
  opts: { clampToReserved?: boolean } = {},
): Promise<{ quantityAfter: number; delta: number }> {
  const row = await lockRow(tx, stockId);
  if (expected != null && row.quantity !== expected) {
    throw new StockError(
      "stale",
      `La cantidad cambió mientras editabas (ahora hay ${row.quantity}). Revisá y volvé a guardar.`,
      { stockId, quantity: row.quantity, reserved: row.reserved },
    );
  }
  let target = Math.max(quantity, 0);
  if (target < row.reserved) {
    if (!opts.clampToReserved) {
      throw new StockError(
        "below_reserved",
        `${row.reserved} ${row.reserved === 1 ? "copia está reservada" : "copias están reservadas"} para pedidos web; la cantidad no puede ser menor.`,
        { stockId, quantity: row.quantity, reserved: row.reserved },
      );
    }
    target = row.reserved;
  }
  const delta = target - row.quantity;
  if (delta !== 0) {
    await tx
      .update(stock)
      .set({ quantity: target, updatedAt: new Date() })
      .where(eq(stock.id, stockId));
    await record(tx, row, delta, target, meta);
  }
  return { quantityAfter: target, delta };
}

/**
 * Adds copies of a variant, creating its stock row if needed.
 * Returns the stock row id.
 */
export async function addStockCopies(
  tx: Tx,
  variant: Variant,
  quantity: number,
  meta: MovementMeta,
  opts: { priceOverrideUsd?: string | null } = {},
): Promise<{ stockId: string; quantityAfter: number }> {
  if (quantity <= 0) throw new StockError("negative", "La cantidad tiene que ser mayor que 0.");
  // Make sure the row exists (quantity 0), then go through the locked path so
  // the movement records the real before/after.
  await tx
    .insert(stock)
    .values({ ...variant, quantity: 0 })
    .onConflictDoNothing({
      target: [stock.printingId, stock.finish, stock.condition, stock.language],
    });
  const [row] = await tx
    .select({ id: stock.id })
    .from(stock)
    .where(
      and(
        eq(stock.printingId, variant.printingId),
        eq(stock.finish, variant.finish),
        eq(stock.condition, variant.condition),
        eq(stock.language, variant.language),
      ),
    );
  if (opts.priceOverrideUsd !== undefined && opts.priceOverrideUsd !== null) {
    await tx
      .update(stock)
      .set({ priceOverrideUsd: opts.priceOverrideUsd })
      .where(eq(stock.id, row.id));
  }
  const { quantityAfter } = await applyStockDelta(tx, row.id, quantity, meta);
  return { stockId: row.id, quantityAfter };
}

/**
 * Deletes a stock row that is empty and was never sold. Rows referenced by
 * order items are kept (order_items.stock_id has no cascade), as are rows
 * holding reservations. Movements survive with stock_id nulled.
 */
export async function deleteEmptyStockRow(tx: Tx, stockId: string): Promise<boolean> {
  const res = await tx.execute(sql`
    delete from stock s
    where s.id = ${stockId}
      and s.quantity = 0
      and s.reserved = 0
      and not exists (select 1 from order_items oi where oi.stock_id = s.id)
  `);
  return (res.rowCount ?? 0) > 0;
}
