import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ConfirmAddForm,
  ConfirmReplaceForm,
  UndoImportForm,
} from "@/components/admin/ImportForms";
import { discardImportAction } from "../actions";
import { M } from "@/lib/messages";
import {
  REPLACE_PHRASE,
  canUndo,
  currentQuantities,
  getImport,
  replaceImpact,
  type StoredLine,
} from "@/lib/stock-import";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.stock.tabs.import} — ${M.storeName}` };

const I = M.admin.imports;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINISH_LABEL: Record<string, string> = {
  nonfoil: M.card.nonfoil,
  foil: M.card.foil,
  etched: M.card.etched,
};
const key = (l: { printingId: string; finish: string; condition: string; language: string }) =>
  `${l.printingId}|${l.finish}|${l.condition}|${l.language}`;

function Variant({ l }: { l: { finish: string; condition: string; language: string } }) {
  return (
    <span className="text-xs whitespace-nowrap">
      <span className={l.finish !== "nonfoil" ? "font-semibold text-foil" : ""}>
        {FINISH_LABEL[l.finish] ?? l.finish}
      </span>{" "}
      · {l.condition} · {l.language.toUpperCase()}
    </span>
  );
}

function LinesTable({ lines, now, showDelta }: { lines: StoredLine[]; now?: Map<string, number>; showDelta: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
            <th className="px-4 py-2">{M.admin.stock.card}</th>
            <th className="px-4 py-2">{M.admin.stock.variant}</th>
            {showDelta && <th className="px-4 py-2 text-right">{I.now}</th>}
            <th className="px-4 py-2 text-right">{showDelta ? I.add : M.admin.stock.qty}</th>
            {showDelta && <th className="px-4 py-2 text-right">{I.after}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const current = now?.get(key(l)) ?? 0;
            return (
              <tr key={key(l)} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-1.5">
                  <span className="font-medium">{l.cardName}</span>{" "}
                  <span className="text-xs text-ink-faint">
                    {l.setName} ({l.setCode.toUpperCase()}) #{l.collectorNumber}
                  </span>
                </td>
                <td className="px-4 py-1.5">
                  <Variant l={l} />
                </td>
                {showDelta && <td className="font-price px-4 py-1.5 text-right text-ink-soft">{current}</td>}
                <td className="font-price px-4 py-1.5 text-right font-semibold text-felt">
                  {showDelta ? `+${l.quantity}` : l.quantity}
                </td>
                {showDelta && (
                  <td className="font-price px-4 py-1.5 text-right">{current + l.quantity}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const imp = await getImport(id);
  if (!imp) notFound();

  const { lines, unmatched } = imp.rows;
  const s = imp.summary;
  const isReplace = imp.kind === "replace";
  const previewing = imp.status === "previewed";
  const [now, impact, undoable] = await Promise.all([
    previewing && !isReplace ? currentQuantities(lines) : undefined,
    previewing && isReplace ? replaceImpact(lines) : undefined,
    canUndo(imp),
  ]);
  const when = (d: Date | null) =>
    d ? d.toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" }) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/stock/importar" className="text-sm text-ink-soft hover:text-felt">
            ← {I.back}
          </Link>
          <h2 className={`mt-2 font-display text-xl font-semibold ${isReplace ? "text-danger" : ""}`}>
            {previewing ? I.previewTitle(imp.kind) : `${I.kind[imp.kind]} · ${I.status[imp.status]}`}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {imp.filename ?? "—"} · {I.lines(s.lines, s.copies)}
            {imp.appliedAt && ` · ${I.status.applied} ${when(imp.appliedAt)}`}
            {imp.undoneAt && ` · ${I.status.undone} ${when(imp.undoneAt)}`}
          </p>
        </div>
        {previewing && (
          <form action={discardImportAction.bind(null, imp.id)}>
            <button type="submit" className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-dim">
              {I.discard}
            </button>
          </form>
        )}
      </div>

      {ok === "aplicada" && (
        <p className="rounded-lg bg-felt/10 px-4 py-3 text-sm font-medium text-felt">{I.applied}</p>
      )}
      {ok === "deshecha" && (
        <p className="rounded-lg bg-felt/10 px-4 py-3 text-sm font-medium text-felt">{I.undone}</p>
      )}
      {imp.status === "discarded" && (
        <p className="rounded-lg bg-paper-dim px-4 py-3 text-sm">{I.discarded}</p>
      )}

      {s.undo && s.undo.notReversed.length > 0 && (
        <div className="rounded-lg bg-foil-soft px-4 py-3 text-sm">
          <p className="font-medium">{I.notReversed}</p>
          <ul className="mt-1 list-disc pl-5">
            {s.undo.notReversed.map((n) => (
              <li key={n.label}>
                {n.label}: {n.done}/{n.wanted}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Replace: impact + guarded confirmation ---- */}
      {impact && (
        <section className="rounded-xl border-2 border-danger/50 bg-white p-5">
          <h3 className="font-display text-lg font-semibold text-danger">⚠ {I.impactTitle}</h3>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [I.impact.current, impact.currentCopies, false],
                [I.impact.file, impact.fileCopies, false],
                [I.impact.removedCopies, impact.removedCopies, impact.removedCopies > 0],
                [I.impact.removedVariants, impact.removedVariants, impact.removedVariants > 0],
                [I.impact.reducedVariants, impact.reducedVariants, false],
                [I.impact.increasedVariants, impact.increasedVariants, false],
                [I.impact.newVariants, impact.newVariants, false],
                [I.impact.held, impact.heldByReservations, false],
              ] as [string, number, boolean][]
            ).map(([label, value, bad]) => (
              <div key={label} className="rounded-lg bg-paper px-3 py-2">
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className={`font-price text-xl font-semibold ${bad ? "text-danger" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>

          {impact.siteChangesSinceLastImport > 0 && (
            <p className="mt-4 rounded-lg bg-foil-soft px-4 py-3 text-sm font-medium">
              {I.siteChanges(impact.siteChangesSinceLastImport, when(impact.lastImportAt))}
            </p>
          )}

          {impact.losses.length > 0 && (
            <details className="mt-4" open={impact.losses.length <= 15}>
              <summary className="cursor-pointer text-sm font-semibold">
                {I.lossesTitle} ({impact.losses.length})
              </summary>
              <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-ink/10">
                <table className="w-full text-sm">
                  <tbody>
                    {impact.losses.slice(0, 300).map((l, i) => (
                      <tr key={i} className="border-b border-ink/5 last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{l.cardName}</span>{" "}
                          <span className="text-xs text-ink-faint">{l.setName}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <Variant l={l} />
                        </td>
                        <td className="font-price px-3 py-1.5 text-right whitespace-nowrap">
                          {l.now} → <strong className="text-danger">{l.after}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="mt-5 rounded-lg bg-paper px-4 py-3 text-sm">
            <a
              href="/api/admin/stock/export?juego=mtg"
              className="font-semibold text-felt underline"
            >
              ⬇ {I.snapshot}
            </a>
            <p className="mt-1 text-xs text-ink-soft">{I.snapshotHelp}</p>
          </div>

          <div className="mt-5 border-t border-ink/10 pt-5">
            <ConfirmReplaceForm id={imp.id} phrase={REPLACE_PHRASE} />
          </div>
        </section>
      )}

      {/* ---- Add: confirm ---- */}
      {previewing && !isReplace && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-felt/30 bg-white p-4">
          <ConfirmAddForm id={imp.id} copies={s.copies} />
          <p className="text-sm text-ink-soft">{I.lines(s.lines, s.copies)}</p>
        </div>
      )}

      {imp.status === "applied" && (
        <div className="flex flex-wrap items-center gap-3">
          {undoable ? (
            <UndoImportForm id={imp.id} />
          ) : (
            <p className="text-sm text-ink-faint">{I.undoOnlyLatest}</p>
          )}
        </div>
      )}

      {unmatched.length > 0 && (
        <details className="rounded-xl border border-foil/40 bg-foil-soft/30 p-4" open={previewing}>
          <summary className="cursor-pointer text-sm font-semibold">{I.unmatchedTitle(unmatched.length)}</summary>
          <p className="mt-1 text-xs text-ink-soft">{I.unmatchedHelp}</p>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-sm">
            {unmatched.map((u, i) => (
              <li key={i}>
                <span className="font-price">{u.quantity}×</span> {u.name ?? "?"}{" "}
                <span className="text-xs text-ink-faint">({u.scryfallId})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {lines.length > 0 &&
        (isReplace ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              {I.lines(s.lines, s.copies)}
            </summary>
            <div className="mt-2">
              <LinesTable lines={lines} showDelta={false} />
            </div>
          </details>
        ) : (
          <LinesTable lines={lines} now={now} showDelta={previewing} />
        ))}
    </div>
  );
}
