import Link from "next/link";
import { ImportUploadForm } from "@/components/admin/ImportForms";
import { M } from "@/lib/messages";
import { listImports } from "@/lib/stock-import";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.stock.tabs.import} — ${M.storeName}` };

const I = M.admin.imports;

const STATUS_CLS: Record<string, string> = {
  previewed: "bg-foil-soft text-ink",
  applied: "bg-felt/10 text-felt",
  undone: "bg-paper-dim text-ink-soft",
};

export default async function ImportPage() {
  const history = await listImports();

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-display text-lg font-semibold">{I.addTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{I.addHelp}</p>
        <ImportUploadForm kind="add" />
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">{I.historyTitle}</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">{I.noHistory}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                  <th className="px-4 py-3">{I.date}</th>
                  <th className="px-4 py-3">{I.type}</th>
                  <th className="px-4 py-3">{I.fileCol}</th>
                  <th className="px-4 py-3 text-right">{I.copies}</th>
                  <th className="px-4 py-3">{I.state}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-ink-soft">
                      {(h.appliedAt ?? h.createdAt).toLocaleString("es-UY", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className={`px-4 py-2 text-xs font-medium ${h.kind === "replace" ? "text-danger" : ""}`}>
                      {I.kind[h.kind]}
                    </td>
                    <td className="max-w-56 truncate px-4 py-2 text-xs text-ink-soft">{h.filename ?? "—"}</td>
                    <td className="font-price px-4 py-2 text-right">{h.summary.copies}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLS[h.status] ?? ""}`}>
                        {I.status[h.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/admin/stock/importar/${h.id}`} className="text-xs font-medium text-felt hover:underline">
                        {I.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border-2 border-dashed border-danger/40 bg-danger/[0.03] p-5">
        <h2 className="font-display text-lg font-semibold text-danger">⚠ {I.dangerTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{I.dangerHelp}</p>
        <ImportUploadForm kind="replace" />
      </section>
    </div>
  );
}
