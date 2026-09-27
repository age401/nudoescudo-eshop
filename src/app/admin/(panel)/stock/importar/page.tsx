import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { applyDelverImport, previewDelverImport } from "@/lib/delver-import";
import { M } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.stock.title} — ${M.storeName}` };

// Import feedback travels via query params through the post-action redirect.
type ImportFeedback =
  | { kind: "preview"; matched: number; unmatched: number; names: string[] }
  | { kind: "done"; imported: number; unmatched: number }
  | { kind: "error"; message: string }
  | null;

async function importAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const params = new URLSearchParams();
  try {
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("Subí un archivo CSV.");
    const text = await file.text();
    const mode = formData.get("mode") === "replace" ? "replace" : "merge";
    if (formData.get("action") === "preview") {
      const p = await previewDelverImport(text);
      params.set("fb", "preview");
      params.set("m", String(p.matched.length));
      params.set("u", String(p.unmatched.length));
      params.set(
        "names",
        p.unmatched.slice(0, 8).map((x) => x.name ?? x.scryfallId).join("|"),
      );
    } else {
      const r = await applyDelverImport(text, mode);
      params.set("fb", "done");
      params.set("m", String(r.imported));
      params.set("u", String(r.unmatched));
    }
  } catch (err) {
    params.set("fb", "error");
    params.set("msg", err instanceof Error ? err.message : String(err));
  }
  revalidatePath("/admin/stock");
  redirect(`/admin/stock/importar?${params.toString()}`);
}

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{
    fb?: string;
    m?: string;
    u?: string;
    names?: string;
    msg?: string;
  }>;
}) {
  const { fb, m, u, names, msg } = await searchParams;
  const S = M.admin.stock;

  const feedback: ImportFeedback =
    fb === "preview"
      ? {
          kind: "preview",
          matched: Number(m) || 0,
          unmatched: Number(u) || 0,
          names: names ? names.split("|").filter(Boolean) : [],
        }
      : fb === "done"
        ? { kind: "done", imported: Number(m) || 0, unmatched: Number(u) || 0 }
        : fb === "error"
          ? { kind: "error", message: msg ?? "Error" }
          : null;

  return (
    <div>
      {/* Import */}
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-display text-lg font-semibold">{S.import.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{S.import.help}</p>

        {feedback?.kind === "preview" && (
          <div className="mt-3 rounded-lg bg-paper-dim px-4 py-3 text-sm">
            <p className="font-medium">
              {S.import.matched(feedback.matched)} · {S.import.unmatched(feedback.unmatched)}
            </p>
            {feedback.names.length > 0 && (
              <p className="mt-1 text-xs text-ink-faint">
                Sin reconocer: {feedback.names.join(", ")}
              </p>
            )}
          </div>
        )}
        {feedback?.kind === "done" && (
          <p className="mt-3 rounded-lg bg-felt/10 px-4 py-3 text-sm font-medium text-felt">
            {S.import.done(feedback.imported)}{" "}
            {feedback.unmatched > 0 && S.import.unmatched(feedback.unmatched)}
          </p>
        )}
        {feedback?.kind === "error" && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {feedback.message}
          </p>
        )}

        <form action={importAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="font-medium">CSV</span>
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-72 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-felt file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-paper"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{S.import.mode}</span>
            <select
              name="mode"
              className="mt-1 block rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
            >
              <option value="merge">{S.import.merge}</option>
              <option value="replace">{S.import.replace}</option>
            </select>
          </label>
          <button
            type="submit"
            name="action"
            value="preview"
            className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium hover:border-felt"
          >
            {S.import.preview}
          </button>
          <button
            type="submit"
            name="action"
            value="apply"
            className="rounded-lg bg-felt px-4 py-2 text-sm font-semibold text-paper hover:bg-felt-soft"
          >
            {S.import.apply}
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-faint">{S.import.replaceWarning}</p>
      </div>

    </div>
  );
}
