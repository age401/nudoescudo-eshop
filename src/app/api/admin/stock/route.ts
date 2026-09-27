import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { ensurePokemonCardColors } from "@/lib/catalog";
import { addStockCopies } from "@/lib/stock";

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
  await db.transaction((tx) =>
    addStockCopies(
      tx,
      {
        printingId: d.printingId,
        finish: d.finish,
        condition: d.condition,
        language: d.language.toLowerCase(),
      },
      d.quantity,
      { reason: "manual_add" },
      { priceOverrideUsd: d.priceOverrideUsd != null ? d.priceOverrideUsd.toFixed(2) : null },
    ),
  );

  // Lazily fill in Pokemon energy types for the catalog color filter. Never
  // let a TCGdex hiccup block adding stock.
  try {
    await ensurePokemonCardColors(d.printingId);
  } catch (err) {
    console.error("Failed to backfill Pokemon colors", err);
  }

  return NextResponse.json({ ok: true });
}
