"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import {
  ImportError,
  applyImport,
  createImportPreview,
  discardImport,
  undoImport,
} from "@/lib/stock-import";

export type ActionState = { error: string } | null;

function message(err: unknown): string {
  if (err instanceof ImportError) return err.message;
  if (err instanceof Error && /Scryfall/.test(err.message)) return err.message; // parser guidance
  console.error(err);
  return "Algo salió mal. Probá de nuevo o revisá el archivo.";
}

export async function uploadImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const kind = formData.get("kind") === "replace" ? "replace" : "add";
  let id: string;
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo CSV." };
    id = await createImportPreview(await file.text(), file.name || null, kind);
  } catch (err) {
    return { error: message(err) };
  }
  redirect(`/admin/stock/importar/${id}`);
}

export async function applyImportAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await applyImport(id, String(formData.get("phrase") ?? ""));
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/admin/stock", "layout");
  redirect(`/admin/stock/importar/${id}?ok=aplicada`);
}

export async function discardImportAction(id: string): Promise<void> {
  await requireAdmin();
  await discardImport(id);
  redirect("/admin/stock/importar");
}

export async function undoImportAction(id: string): Promise<ActionState> {
  await requireAdmin();
  try {
    await undoImport(id);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/admin/stock", "layout");
  redirect(`/admin/stock/importar/${id}?ok=deshecha`);
}
