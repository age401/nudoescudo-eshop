"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmSaleAction,
  draftFromScanAction,
  searchSaleCandidatesAction,
} from "@/app/admin/(panel)/venta/actions";
import type { Candidate, DraftLine, DraftProblem } from "@/lib/in-store";
import { M } from "@/lib/messages";
import { formatUsd, round2 } from "@/lib/pricing";

const T = M.admin.sale;
const FINISH_LABEL: Record<string, string> = {
  nonfoil: M.card.nonfoil,
  foil: M.card.foil,
  etched: M.card.etched,
  reverse: M.card.reverse,
};

type Line = DraftLine & { problemId?: string; price: string };
type Resolution = { kind: "skip" } | { kind: "line"; lineId: string };

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-16 w-auto shrink-0 rounded shadow-sm" loading="lazy" />
  ) : (
    <div className="h-16 w-12 shrink-0 rounded bg-paper-dim" />
  );
}

function VariantText({ c }: { c: Pick<Candidate, "finish" | "condition" | "language"> }) {
  return (
    <span className="text-xs whitespace-nowrap">
      <span className={c.finish !== "nonfoil" ? "font-semibold text-foil" : ""}>
        {FINISH_LABEL[c.finish] ?? c.finish}
      </span>{" "}
      · {c.condition} · {c.language.toUpperCase()}
    </span>
  );
}

let seq = 0;
const newId = () => `x${++seq}`;

/**
 * Counter sale: upload a Delver scan → review (resolve every flagged card,
 * adjust quantities/prices) → confirm. Nothing touches stock until confirm.
 */
export function InStoreSale() {
  const router = useRouter();
  const [phase, setPhase] = useState<"upload" | "review">("upload");
  const [lines, setLines] = useState<Line[]>([]);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [scanned, setScanned] = useState(0);
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Copies of each stock row used by the whole draft, to cap every input.
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.candidate.stockId, (m.get(l.candidate.stockId) ?? 0) + l.quantity);
    return m;
  }, [lines]);
  const freeFor = (c: Candidate, exceptLine?: Line) =>
    c.available - (used.get(c.stockId) ?? 0) + (exceptLine ? exceptLine.quantity : 0);

  const open = problems.filter((p) => !resolved[p.id]);
  const total = round2(lines.reduce((n, l) => n + l.quantity * (Number(l.price.replace(",", ".")) || 0), 0));
  const copies = lines.reduce((n, l) => n + l.quantity, 0);
  const dirty = phase === "review" && (lines.length > 0 || problems.length > 0);
  const priceOk = (v: string) => v.trim() !== "" && Number(v.replace(",", ".")) >= 0;
  const unpriced = lines.filter((l) => !priceOk(l.price)).length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = T.leaveWarning;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // No reference price → the field starts empty and must be filled: a
  // silent US$ 0 would give the card away. Typing 0 on purpose is allowed.
  function toLine(d: DraftLine, extra: Partial<Line> = {}): Line {
    return { ...d, price: d.candidate.unitPriceUsd != null ? d.unitPriceUsd.toFixed(2) : "", ...extra };
  }

  function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await draftFromScanAction(fd);
      if ("error" in res) return setError(res.error);
      setLines(res.draft.lines.map((l) => toLine(l)));
      setProblems(res.draft.problems);
      setScanned(res.draft.scannedCopies);
      setResolved({});
      setPhase("review");
    });
  }

  function startManual() {
    setLines([]);
    setProblems([]);
    setResolved({});
    setScanned(0);
    setPhase("review");
  }

  function restart() {
    if (dirty && !confirm(T.confirmRestart)) return;
    setPhase("upload");
    setLines([]);
    setProblems([]);
    setResolved({});
    setCustomer("");
    setNote("");
    setError(null);
    setFlagged(new Set());
    setRequestId(crypto.randomUUID());
    if (fileRef.current) fileRef.current.value = "";
  }

  function applySuggestion(p: DraftProblem, c: Candidate) {
    const qty = Math.min(p.missing, freeFor(c));
    if (qty <= 0) return;
    const line = toLine(
      { id: newId(), candidate: c, quantity: qty, unitPriceUsd: c.unitPriceUsd ?? 0, source: "suggestion" },
      { problemId: p.id },
    );
    setLines((ls) => [...ls, line]);
    setResolved((r) => ({ ...r, [p.id]: { kind: "line", lineId: line.id } }));
  }

  function unresolve(p: DraftProblem) {
    const r = resolved[p.id];
    if (r?.kind === "line") setLines((ls) => ls.filter((l) => l.id !== r.lineId));
    setResolved((all) => {
      const next = { ...all };
      delete next[p.id];
      return next;
    });
  }

  function removeLine(l: Line) {
    setLines((ls) => ls.filter((x) => x.id !== l.id));
    if (l.problemId) {
      setResolved((all) => {
        const next = { ...all };
        delete next[l.problemId!];
        return next;
      });
    }
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addManual(c: Candidate) {
    const existing = lines.find((l) => l.candidate.stockId === c.stockId && l.source === "manual");
    if (existing) {
      if (freeFor(c) > 0) updateLine(existing.id, { quantity: existing.quantity + 1 });
      return;
    }
    if (freeFor(c) <= 0) return;
    setLines((ls) => [
      ...ls,
      toLine({ id: newId(), candidate: c, quantity: 1, unitPriceUsd: c.unitPriceUsd ?? 0, source: "manual" }),
    ]);
  }

  function confirmSale() {
    setError(null);
    startTransition(async () => {
      const res = await confirmSaleAction({
        requestId,
        customerName: customer || undefined,
        note: note || undefined,
        lines: lines.map((l) => ({
          stockId: l.candidate.stockId,
          quantity: l.quantity,
          unitPriceUsd: round2(Number(l.price.replace(",", ".")) || 0),
        })),
      });
      if (res.ok) {
        setPhase("upload"); // drops the unload guard before navigating
        router.push(`/admin/pedidos/${res.orderId}?venta=ok`);
        return;
      }
      setError(
        [res.message, ...res.problems.map((p) => `${p.label}: ${T.maxAvailable(p.available)}`)].join(" "),
      );
      setFlagged(new Set(res.problems.map((p) => p.stockId)));
    });
  }

  // ------------------------------------------------------------------ upload
  if (phase === "upload") {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <p className="max-w-3xl text-sm text-ink-soft">{T.intro}</p>
        <form onSubmit={upload} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="font-medium">{T.file}</span>
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-80 max-w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-felt file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-paper"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-felt px-4 py-2 text-sm font-semibold text-paper hover:bg-felt-soft disabled:opacity-60"
          >
            {pending ? T.uploading : T.upload}
          </button>
          <span className="text-sm text-ink-faint">{T.orManual}</span>
          <button
            type="button"
            onClick={startManual}
            className="rounded-lg border border-ink/15 px-3 py-2 text-sm hover:border-felt"
          >
            {T.searchTitle}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ review
  return (
    <div className="space-y-6 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{scanned > 0 && T.scanned(scanned)}</p>
        <button type="button" onClick={restart} className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-dim">
          ↺ {T.restart}
        </button>
      </div>

      {problems.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold">
            {open.length > 0 ? (
              <span className="text-danger">⚠ {T.problemsTitle(open.length)}</span>
            ) : (
              <span className="text-felt">✓ {T.problemsDone}</span>
            )}
          </h2>
          {open.length > 0 && <p className="mt-1 max-w-3xl text-sm text-ink-soft">{T.problemsHelp}</p>}
          <div className="mt-3 space-y-3">
            {problems.map((p) => (
              <ProblemCard
                key={p.id}
                p={p}
                resolution={resolved[p.id]}
                line={(() => {
                  const r = resolved[p.id];
                  return r?.kind === "line" ? lines.find((l) => l.id === r.lineId) : undefined;
                })()}
                freeFor={freeFor}
                onUse={(c) => applySuggestion(p, c)}
                onSkip={() => setResolved((r) => ({ ...r, [p.id]: { kind: "skip" } }))}
                onChange={() => unresolve(p)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">{T.linesTitle}</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{T.noLines}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                  <th className="px-3 py-2">{M.admin.stock.card}</th>
                  <th className="px-3 py-2">{M.admin.stock.variant}</th>
                  <th className="px-3 py-2 text-right">{M.admin.stock.qty}</th>
                  <th className="px-3 py-2 text-right">{T.unitPrice}</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const max = freeFor(l.candidate, l);
                  const price = Number(l.price.replace(",", ".")) || 0;
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-ink/5 last:border-0 ${flagged.has(l.candidate.stockId) ? "bg-danger/10" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <Thumb src={l.candidate.imageSmall} />
                          <div>
                            <p className="font-medium">
                              {l.candidate.cardName}
                              {l.source !== "match" && (
                                <span className="ml-2 rounded bg-foil-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                  {l.source === "suggestion" ? T.suggestedTag : T.manualTag}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-ink-faint">
                              {l.candidate.setName} ({l.candidate.setCode.toUpperCase()}) #{l.candidate.collectorNumber}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <VariantText c={l.candidate} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          max={max}
                          value={l.quantity}
                          title={T.maxAvailable(max)}
                          onChange={(e) =>
                            updateLine(l.id, {
                              quantity: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), max),
                            })
                          }
                          className="font-price w-16 rounded border border-ink/15 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={l.price}
                          placeholder="?"
                          onChange={(e) => updateLine(l.id, { price: e.target.value })}
                          className={`font-price w-20 rounded border px-2 py-1 text-right ${
                            priceOk(l.price) ? "border-ink/15" : "border-danger bg-danger/5"
                          }`}
                        />
                      </td>
                      <td className="font-price px-3 py-2 text-right font-semibold">
                        {formatUsd(round2(price * l.quantity))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(l)}
                          aria-label={T.remove}
                          title={T.remove}
                          className="rounded px-2 py-1 text-ink-faint hover:bg-danger/10 hover:text-danger"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ManualSearch onAdd={addManual} freeFor={freeFor} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">{T.customer}</span>
          <input
            type="text"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            maxLength={200}
            className="mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{T.note}</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
          />
        </label>
      </section>

      {/* Sticky footer: total and the one action. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            {error ? (
              <span role="alert" className="font-medium text-danger">{error}</span>
            ) : open.length > 0 ? (
              <span className="font-medium text-danger">{T.pendingProblems(open.length)}</span>
            ) : unpriced > 0 ? (
              <span className="font-medium text-danger">{T.missingPrices(unpriced)}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-soft">
              {T.total}: <strong className="font-price text-xl text-felt">{formatUsd(total)}</strong>
            </span>
            <button
              type="button"
              onClick={confirmSale}
              disabled={pending || open.length > 0 || unpriced > 0 || lines.length === 0}
              className="rounded-lg bg-felt px-5 py-2.5 text-sm font-semibold text-paper hover:bg-felt-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? T.confirming : T.confirm(copies)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProblemCard({
  p,
  resolution,
  line,
  freeFor,
  onUse,
  onSkip,
  onChange,
}: {
  p: DraftProblem;
  resolution: Resolution | undefined;
  line: Line | undefined;
  freeFor: (c: Candidate) => number;
  onUse: (c: Candidate) => void;
  onSkip: () => void;
  onChange: () => void;
}) {
  const name = p.readAs?.cardName ?? p.scanned.name ?? "?";
  const header = (
    <div>
      <p className="font-medium">
        <span className="font-price mr-1">{p.missing}×</span> {name}
      </p>
      <p className="text-xs text-ink-soft">
        {T.read}:{" "}
        {p.readAs
          ? `${p.readAs.setName} (${p.readAs.setCode.toUpperCase()}) #${p.readAs.collectorNumber}`
          : T.unknownPrinting}{" "}
        · {p.scanned.foil ? M.card.foil : M.card.nonfoil}
      </p>
    </div>
  );

  if (resolution) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-felt/30 bg-felt/5 px-4 py-3">
        {header}
        <div className="flex items-center gap-3 text-sm">
          {resolution.kind === "skip" ? (
            <span className="text-ink-soft">{T.skipped}</span>
          ) : (
            line && (
              <span>
                ✓ {T.resolvedWith} <strong>{line.candidate.setName}</strong> · <VariantText c={line.candidate} />
              </span>
            )
          )}
          <button type="button" onClick={onChange} className="rounded-lg px-2 py-1 text-xs text-felt hover:underline">
            {T.change}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-danger/40 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium hover:border-danger hover:text-danger"
        >
          {T.skip}
        </button>
      </div>
      <p className="mt-2 text-sm text-danger">
        {p.reason === "short" ? T.reasons.short(p.missing) : T.reasons[p.reason]}
        {p.reservedBy.map((r) => (
          <Link key={r.orderId} href={`/admin/pedidos/${r.orderId}`} className="font-price ml-2 font-semibold underline" target="_blank">
            {r.code}
          </Link>
        ))}
      </p>

      {p.suggestions.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">{T.noSuggestions}</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold text-ink-soft">{T.suggestionsTitle}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {p.suggestions.map((c, i) => {
              const free = freeFor(c);
              return (
                <li key={c.stockId}>
                  <button
                    type="button"
                    disabled={free <= 0}
                    onClick={() => onUse(c)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left hover:border-felt hover:bg-felt/5 disabled:opacity-40 ${
                      i === 0 ? "border-felt/50" : "border-ink/10"
                    }`}
                  >
                    <Thumb src={c.imageSmall} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {c.setName}{" "}
                        {i === 0 && (
                          <span className="ml-1 rounded bg-felt px-1.5 py-0.5 text-[10px] font-semibold uppercase text-paper">
                            {T.likely}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {c.setCode.toUpperCase()} #{c.collectorNumber}
                      </span>
                      <VariantText c={c} />
                      <span className="block text-xs text-ink-soft">
                        {T.available(Math.max(free, 0))} · {c.unitPriceUsd != null ? formatUsd(c.unitPriceUsd) : M.card.noPrice}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-felt px-3 py-1.5 text-xs font-semibold text-paper">
                      {T.use}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ManualSearch({
  onAdd,
  freeFor,
}: {
  onAdd: (c: Candidate) => void;
  freeFor: (c: Candidate) => number;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Candidate[]>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      startTransition(async () => setHits(await searchSaleCandidatesAction(q)));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length < 2 ? [] : hits;

  return (
    <div className="mt-4 rounded-xl border border-dashed border-ink/20 bg-white p-4">
      <p className="text-sm font-medium">{T.searchTitle}</p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={T.searchPlaceholder}
        className="mt-2 block w-full max-w-md rounded-lg border border-ink/15 px-3 py-2 text-sm"
      />
      {shown.length > 0 && (
        <ul className="mt-2 max-h-80 divide-y divide-ink/5 overflow-y-auto rounded-lg border border-ink/10">
          {shown.map((c) => {
            const free = freeFor(c);
            return (
              <li key={c.stockId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{c.cardName}</span>{" "}
                  <span className="text-xs text-ink-faint">
                    {c.setName} ({c.setCode.toUpperCase()}) #{c.collectorNumber}
                  </span>{" "}
                  <VariantText c={c} />
                  <span className="ml-2 text-xs text-ink-soft">
                    {T.available(Math.max(free, 0))} · {c.unitPriceUsd != null ? formatUsd(c.unitPriceUsd) : M.card.noPrice}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={free <= 0}
                  onClick={() => onAdd(c)}
                  className="shrink-0 rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium hover:border-felt disabled:opacity-40"
                >
                  + {T.add}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
