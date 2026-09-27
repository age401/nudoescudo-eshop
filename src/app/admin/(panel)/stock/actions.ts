"use server";

import { revalidatePath } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orders, stock, stockMovements } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { StockError, deleteEmptyStockRow, setStockQuantity } from "@/lib/stock";

export type SaveStockState = {
  ok: boolean;
  message: string;
  /** Current values after the save (or after a refused save), to resync the row. */
  quantity?: number;
  reserved?: number;
  override?: string | null;
  at?: number;
} | null;

const SaveInput = z.object({
  id: z.string().uuid(),
  quantity: z.coerce.number().int().min(0).max(99999),
  expected: z.coerce.number().int().min(0),
  override: z
    .string()
    .trim()
    .transform((v) => v.replace(",", "."))
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 100000), {
      message: "El precio manual tiene que ser un número mayor que 0.",
    }),
  note: z.string().trim().max(500).optional().default(""),
});

export async function saveStockRow(_prev: SaveStockState, formData: FormData): Promise<SaveStockState> {
  await requireAdmin();
  const parsed = SaveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos.", at: Date.now() };
  }
  const d = parsed.data;
  const override = d.override === "" ? null : Number(d.override).toFixed(2);
  try {
    const result = await db.transaction(async (tx) => {
      const { quantityAfter } = await setStockQuantity(tx, d.id, d.quantity, d.expected, {
        reason: "manual_adjust",
        note: d.note,
      });
      const [row] = await tx
        .update(stock)
        .set({ priceOverrideUsd: override, updatedAt: new Date() })
        .where(eq(stock.id, d.id))
        .returning();
      return { quantity: quantityAfter, reserved: row.reserved, override: row.priceOverrideUsd };
    });
    revalidatePath("/admin/stock");
    return { ok: true, message: "Guardado.", ...result, at: Date.now() };
  } catch (err) {
    if (err instanceof StockError) {
      return {
        ok: false,
        message: err.message,
        quantity: err.details.quantity,
        reserved: err.details.reserved,
        at: Date.now(),
      };
    }
    throw err;
  }
}

export async function deleteStockRow(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const deleted = await db.transaction((tx) => deleteEmptyStockRow(tx, id));
  revalidatePath("/admin/stock");
  return deleted
    ? { ok: true, message: "Fila eliminada." }
    : {
        ok: false,
        message:
          "Solo se pueden eliminar filas sin copias, sin reservas y que nunca se vendieron (esas quedan en 0 para conservar el historial de pedidos).",
      };
}

export type HistoryEntry = {
  id: string;
  delta: number;
  quantityAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
  orderId: string | null;
  orderCode: string | null;
  importId: string | null;
};

export async function stockRowHistory(id: string): Promise<HistoryEntry[]> {
  await requireAdmin();
  const rows = await db
    .select({
      id: stockMovements.id,
      delta: stockMovements.delta,
      quantityAfter: stockMovements.quantityAfter,
      reason: stockMovements.reason,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      orderId: stockMovements.orderId,
      orderCode: sql<string | null>`${orders.publicCode}`,
      importId: stockMovements.importId,
    })
    .from(stockMovements)
    .leftJoin(orders, eq(orders.id, stockMovements.orderId))
    .where(eq(stockMovements.stockId, id))
    .orderBy(desc(stockMovements.createdAt))
    .limit(100);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
