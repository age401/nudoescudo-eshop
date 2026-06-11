import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stock } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { applyDelverImport, previewDelverImport } from "@/lib/delver-import";
import { M } from "@/lib/messages";
import { normalizeName } from "@/lib/normalize";
import { formatUsd } from "@/lib/pricing";
import { getPricingContext } from "@/lib/settings";
import { computeUnitPriceUsd } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.stock.title} — ${M.storeName}` };

type ImportFeedback =
  | { kind: "preview"; matched: number; unmatched: number; names: string[] }
  | { kind: "done"; imported: number; unmatched: number }
  | { kind: "error"; message: string }
  | null;

// Module-level feedback survives the redirect-free form roundtrip in this
// single-process server. Good enough for a one-admin tool.
let lastImportFeedback: ImportFeedback = null;

async function importAction(formData: FormData) {
  "use server";
  await requireAdmin();
  try {
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("Subí un archivo CSV.");
    const text = await file.text();
    const mode = formData.get("mode") === "replace" ? "replace" : "merge";
    if (formData.get("action") === "preview") {
      const p = await previewDelverImport(text);
      lastImportFeedback = {
        kind: "preview",
        matched: p.matched.length,
        unmatched: p.unmatched.length,
        names: p.unmatched.slice(0, 10).map((u) => u.name ?? u.scryfallId),
      };
    } else {
      const r = await applyDelverImport(text, mode);
      lastImportFeedback = {
        kind: "done",
        imported: r.imported,
        unmatched: r.unmatched,
      };
    }
  } catch (err) {
    lastImportFeedback = {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  revalidatePath("/admin/stock");
}

async function updateStockAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const quantity = Math.max(parseInt(String(formData.get("quantity")), 10) || 0, 0);
  const overrideRaw = String(formData.get("override") ?? "").trim().replace(",", ".");
  const override = overrideRaw === "" ? null : Number(overrideRaw);
  await db
    .update(stock)
    .set({
      quantity,
      priceOverrideUsd:
        override != null && Number.isFinite(override) && override > 0
          ? override.toFixed(2)
          : null,
      updatedAt: new Date(),
    })
    .where(eq(stock.id, id));
  revalidatePath("/admin/stock");
}

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const S = M.admin.stock;
  const { multiplier } = await getPricingContext();

  const filter = q ? `%${normalizeName(q)}%` : null;
  const rows = (
    await db.execute(sql`
      select s.id, s.finish, s.condition, s.language, s.quantity, s.reserved,
             s.price_override_usd,
             c.name as card_name, p.set_name, p.collector_number,
             pr.price_usd as reference_usd
      from stock s
      join printings p on p.id = s.printing_id
      join cards c on c.id = p.card_id
      left join prices pr on pr.printing_id = s.printing_id and pr.finish = s.finish
      ${filter ? sql`where c.normalized_name like ${filter}` : sql``}
      order by c.name, p.set_name, s.finish
      limit 500
    `)
  ).rows as Record<string, unknown>[];

  const feedback = lastImportFeedback;
  lastImportFeedback = null;

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

      {/* Stock table */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{S.title}</h2>
        <form className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={S.search}
            className="w-64 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-ink-soft">{S.empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="px-4 py-3">{S.card}</th>
                <th className="px-4 py-3">{S.variant}</th>
                <th className="px-4 py-3 text-right">{S.qty}</th>
                <th className="px-4 py-3 text-right">{S.reserved}</th>
                <th className="px-4 py-3 text-right">{S.price}</th>
                <th className="px-4 py-3 text-right">{S.override}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const override = r.price_override_usd != null ? Number(r.price_override_usd) : null;
                const sale = computeUnitPriceUsd({
                  referenceUsd: r.reference_usd != null ? Number(r.reference_usd) : null,
                  overrideUsd: override,
                  multiplier,
                });
                return (
                  <tr key={r.id as string} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium">{r.card_name as string}</p>
                      <p className="text-xs text-ink-faint">
                        {r.set_name as string} #{r.collector_number as string}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {(r.finish as string) === "nonfoil" ? "Normal" : (r.finish as string)} ·{" "}
                      {r.condition as string} · {(r.language as string).toUpperCase()}
                    </td>
                    <td className="font-price px-4 py-2 text-right" colSpan={1}>
                      <form action={updateStockAction} className="flex items-center justify-end gap-2" id={`f-${r.id}`}>
                        <input type="hidden" name="id" value={r.id as string} />
                        <input
                          type="number"
                          name="quantity"
                          min={0}
                          defaultValue={r.quantity as number}
                          className="w-16 rounded border border-ink/15 px-2 py-1 text-right text-sm"
                        />
                      </form>
                    </td>
                    <td className="font-price px-4 py-2 text-right text-ink-faint">
                      {r.reserved as number}
                    </td>
                    <td className="font-price px-4 py-2 text-right font-semibold text-felt">
                      {sale != null ? formatUsd(sale) : M.card.noPrice}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="text"
                        name="override"
                        form={`f-${r.id}`}
                        defaultValue={override != null ? override.toFixed(2) : ""}
                        placeholder={S.noOverride}
                        className="w-20 rounded border border-ink/15 px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="submit"
                        form={`f-${r.id}`}
                        className="rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium hover:border-felt"
                      >
                        {S.save}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
