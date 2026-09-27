"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import {
  buildSaleDraft,
  confirmSale,
  searchSaleCandidates,
  type Candidate,
  type ConfirmSaleResult,
  type SaleDraft,
} from "@/lib/in-store";

export async function draftFromScanAction(
  formData: FormData,
): Promise<{ draft: SaleDraft } | { error: string }> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí el CSV exportado de Delver Lens." };
  try {
    const draft = await buildSaleDraft(await file.text());
    if (draft.scannedCopies === 0) return { error: "El archivo no tiene cartas con Scryfall ID." };
    return { draft };
  } catch (err) {
    if (err instanceof Error && /Scryfall/.test(err.message)) return { error: err.message };
    console.error(err);
    return { error: "No se pudo leer el archivo. ¿Es el CSV de Delver Lens?" };
  }
}

export async function searchSaleCandidatesAction(q: string): Promise<Candidate[]> {
  await requireAdmin();
  return searchSaleCandidates(q);
}

const ConfirmInput = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        stockId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        unitPriceUsd: z.number().min(0).max(99999),
      }),
    )
    .min(1)
    .max(2000),
});

export async function confirmSaleAction(input: z.input<typeof ConfirmInput>): Promise<ConfirmSaleResult> {
  await requireAdmin();
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [], message: "Revisá cantidades y precios." };
  const res = await confirmSale(parsed.data);
  if (res.ok) {
    revalidatePath("/admin", "layout");
  }
  return res;
}
