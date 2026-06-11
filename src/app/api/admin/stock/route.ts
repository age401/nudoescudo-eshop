import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { stock } from "@/db/schema";
import { isAdmin } from "@/lib/admin-auth";

const Body = z.object({
  printingId: z.string().uuid(),
  finish: z.enum(["nonfoil", "foil", "etched", "reverse"]),
  condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
  language: z.string().min(2).max(3),
  quantity: z.number().int().min(1).max(999),
  priceOverrideUsd: z.number().positive().max(99999).nullable().optional(),
});

/** Admin-only: add stock manually (used for Pokemon and ad-hoc MTG entries). */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const d = parsed.data;
  await db
    .insert(stock)
    .values({
      printingId: d.printingId,
      finish: d.finish,
      condition: d.condition,
      language: d.language.toLowerCase(),
      quantity: d.quantity,
      priceOverrideUsd: d.priceOverrideUsd != null ? d.priceOverrideUsd.toFixed(2) : null,
    })
    .onConflictDoUpdate({
      target: [stock.printingId, stock.finish, stock.condition, stock.language],
      set: {
        quantity: sql`${stock.quantity} + ${d.quantity}`,
        ...(d.priceOverrideUsd != null
          ? { priceOverrideUsd: d.priceOverrideUsd.toFixed(2) }
          : {}),
        updatedAt: new Date(),
      },
    });
  return NextResponse.json({ ok: true });
}
