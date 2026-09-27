"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  deleteStockRow,
  saveStockRow,
  stockRowHistory,
  type HistoryEntry,
} from "@/app/admin/(panel)/stock/actions";
import { M } from "@/lib/messages";
import { computeUnitPriceUsd, formatUsd } from "@/lib/pricing";

export type StockRowData = {
  id: string;
  cardName: string;
  gameId: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
  reserved: number;
  overrideUsd: string | null;
  referenceUsd: number | null;
  imageSmall: string | null;
};

const S = M.admin.stock;
const FINISH_LABEL: Record<string, string> = {
  nonfoil: M.card.nonfoil,
  foil: M.card.foil,
  etched: M.card.etched,
  reverse: M.card.reverse,
};

/**
 * One editable stock row. Edits stay local until saved; the save carries the
 * quantity the row was rendered with, so a sale or import that happened in
 * the meantime is reported instead of overwritten.
 */
export function StockRow({
  row,
  multiplier,
  minimumUsd,
}: {
  row: StockRowData;
  multiplier: number;
  minimumUsd: number;
}) {
  const [base, setBase] = useState({
    quantity: row.quantity,
    reserved: row.reserved,
    override: row.overrideUsd != null ? Number(row.overrideUsd).toFixed(2) : "",
  });
  const [qty, setQty] = useState(String(row.quantity));
  const [override, setOverride] = useState(base.override);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [pending, startTransition] = useTransition();

  const qtyNum = Math.max(parseInt(qty, 10) || 0, 0);
  const dirty = qtyNum !== base.quantity || override.trim() !== base.override;

  // The server re-renders after any change (this row's save, another tab, a
  // sale). Adopt the fresh values; keep in-progress edits unless they would
  // now be based on a stale quantity, in which case the save will say so.
  const [seen, setSeen] = useState(row);
  if (seen !== row) {
    setSeen(row);
    const fresh = {
      quantity: row.quantity,
      reserved: row.reserved,
      override: row.overrideUsd != null ? Number(row.overrideUsd).toFixed(2) : "",
    };
    if (
      fresh.quantity !== base.quantity ||
      fresh.reserved !== base.reserved ||
      fresh.override !== base.override
    ) {
      setBase(fresh);
      if (!dirty) {
        setQty(String(fresh.quantity));
        setOverride(fresh.override);
      }
    }
  }
  const qtyChanged = qtyNum !== base.quantity;
  const belowReserved = qtyNum < base.reserved;

  const overrideNum = Number(override.replace(",", "."));
  const sale = computeUnitPriceUsd({
    referenceUsd: row.referenceUsd,
    overrideUsd: override.trim() !== "" && overrideNum > 0 ? overrideNum : null,
    multiplier,
    minimumUsd,
  });

  function reset() {
    setQty(String(base.quantity));
    setOverride(base.override);
    setNote("");
  }

  function save() {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("quantity", String(qtyNum));
    fd.set("expected", String(base.quantity));
    fd.set("override", override);
    fd.set("note", note);
    startTransition(async () => {
      const res = await saveStockRow(null, fd);
      if (!res) return;
      if (res.quantity != null) {
        const next = {
          quantity: res.quantity,
          reserved: res.reserved ?? base.reserved,
          override: res.ok
            ? res.override != null
              ? Number(res.override).toFixed(2)
              : ""
            : base.override,
        };
        setBase(next);
        if (res.ok) {
          setQty(String(next.quantity));
          setOverride(next.override);
          setNote("");
        }
      }
      setFlash({ ok: res.ok, text: res.message });
      if (res.ok) setTimeout(() => setFlash(null), 2500);
      if (history) setHistory(await stockRowHistory(row.id));
    });
  }

  function toggleHistory() {
    if (history) return setHistory(null);
    startTransition(async () => setHistory(await stockRowHistory(row.id)));
  }

  function remove() {
    if (!confirm(S.confirmDelete)) return;
    startTransition(async () => {
      const res = await deleteStockRow(row.id);
      if (res.ok) setDeleted(true);
      else setFlash({ ok: false, text: res.message });
    });
  }

  if (deleted) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && dirty && !pending) save();
    if (e.key === "Escape") reset();
  };

  return (
    <>
      <tr
        className={`border-b border-ink/5 align-middle ${dirty ? "bg-foil-soft/40" : ""} ${
          base.quantity === 0 ? "text-ink-faint" : ""
        }`}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-3">
            {row.imageSmall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.imageSmall} alt="" className="h-12 w-auto rounded shadow-sm" loading="lazy" />
            ) : (
              <div className="h-12 w-9 rounded bg-paper-dim" />
            )}
            <div className="min-w-0">
              <p className="font-medium text-ink">{row.cardName}</p>
              <p className="text-xs text-ink-faint">
                {row.gameId === "pokemon" ? "PKM · " : ""}
                {row.setName} ({row.setCode.toUpperCase()}) #{row.collectorNumber}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <span className={row.finish !== "nonfoil" ? "font-semibold text-foil" : ""}>
            {FINISH_LABEL[row.finish] ?? row.finish}
          </span>{" "}
          · {row.condition} · {row.language.toUpperCase()}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label="Restar una"
              onClick={() => setQty(String(Math.max(qtyNum - 1, 0)))}
              className="h-7 w-7 rounded border border-ink/15 text-ink-soft hover:border-felt hover:text-felt"
            >
              −
            </button>
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={onKey}
              aria-label={S.qty}
              className={`font-price w-14 rounded border px-2 py-1 text-right text-sm ${
                belowReserved ? "border-danger text-danger" : "border-ink/15"
              }`}
            />
            <button
              type="button"
              aria-label="Sumar una"
              onClick={() => setQty(String(qtyNum + 1))}
              className="h-7 w-7 rounded border border-ink/15 text-ink-soft hover:border-felt hover:text-felt"
            >
              +
            </button>
          </div>
        </td>
        <td className="font-price px-3 py-2 text-right" title={base.reserved ? S.reservedHint(base.reserved) : undefined}>
          {base.reserved > 0 ? (
            <span className="rounded bg-foil-soft px-1.5 py-0.5 font-semibold">{base.reserved}</span>
          ) : (
            <span className="text-ink-faint">0</span>
          )}
        </td>
        <td className="font-price px-3 py-2 text-right whitespace-nowrap">
          <span className="font-semibold text-felt">{sale != null ? formatUsd(sale) : M.card.noPrice}</span>
          {override.trim() !== "" && (
            <span className="ml-1 rounded bg-paper-dim px-1 text-[10px] uppercase text-ink-soft">
              {S.manualTag}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="text"
            inputMode="decimal"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            onKeyDown={onKey}
            placeholder={S.noOverride}
            aria-label={S.override}
            className="font-price w-20 rounded border border-ink/15 px-2 py-1 text-right text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            {dirty ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending || belowReserved}
                  className="rounded-lg bg-felt px-3 py-1 text-xs font-semibold text-paper hover:bg-felt-soft disabled:opacity-50"
                >
                  {pending ? S.saving : S.save}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={pending}
                  className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper-dim"
                >
                  {S.cancel}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleHistory}
                  className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper-dim"
                >
                  {history ? S.hideHistory : S.history}
                </button>
                {base.quantity === 0 && base.reserved === 0 && (
                  <button
                    type="button"
                    onClick={remove}
                    disabled={pending}
                    title={S.delete}
                    aria-label={S.delete}
                    className="rounded-lg px-2 py-1 text-xs text-ink-faint hover:bg-danger/10 hover:text-danger"
                  >
                    ✕
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {(qtyChanged || flash || belowReserved) && (
        <tr className={`border-b border-ink/5 ${dirty ? "bg-foil-soft/40" : ""}`}>
          <td colSpan={7} className="px-3 pb-2 pt-0">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {qtyChanged && (
                <>
                  <span className="font-price text-ink-soft">
                    {base.quantity} → <strong className="text-ink">{qtyNum}</strong> (
                    {qtyNum - base.quantity > 0 ? "+" : ""}
                    {qtyNum - base.quantity})
                  </span>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={S.notePlaceholder}
                    aria-label={S.note}
                    maxLength={500}
                    className="w-72 rounded border border-ink/15 bg-white px-2 py-1"
                  />
                </>
              )}
              {belowReserved && (
                <span className="font-medium text-danger">
                  {S.reservedHint(base.reserved)}: no se puede bajar de {base.reserved}.
                </span>
              )}
              {flash && (
                <span className={`font-medium ${flash.ok ? "text-felt" : "text-danger"}`} role="status">
                  {flash.text}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
      {history && (
        <tr className="border-b border-ink/5 bg-paper">
          <td colSpan={7} className="px-6 py-3">
            {history.length === 0 ? (
              <p className="text-xs text-ink-faint">{S.noHistory}</p>
            ) : (
              <table className="w-full max-w-3xl text-xs">
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-ink/5 last:border-0">
                      <td className="py-1 pr-4 text-ink-faint whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleString("es-UY", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className={`font-price py-1 pr-4 text-right font-semibold ${h.delta > 0 ? "text-felt" : "text-danger"}`}>
                        {h.delta > 0 ? "+" : ""}
                        {h.delta}
                      </td>
                      <td className="font-price py-1 pr-4 text-right text-ink-soft">= {h.quantityAfter}</td>
                      <td className="py-1 pr-4">{M.admin.movements.reasons[h.reason] ?? h.reason}</td>
                      <td className="py-1 text-ink-soft">
                        {h.orderId && (
                          <Link href={`/admin/pedidos/${h.orderId}`} className="font-price text-felt hover:underline">
                            {h.orderCode}
                          </Link>
                        )}
                        {h.importId && (
                          <Link href={`/admin/stock/importar/${h.importId}`} className="text-felt hover:underline">
                            ver importación
                          </Link>
                        )}
                        {h.note && <span className="ml-2 italic">“{h.note}”</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
