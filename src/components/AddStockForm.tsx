"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PrintingHit = {
  printing_id: string;
  card_name: string;
  game_id: string;
  set_name: string;
  collector_number: string;
  finishes: string[];
};

const FINISH_LABEL: Record<string, string> = {
  nonfoil: "Normal",
  foil: "Foil",
  reverse: "Reverse Holo",
  etched: "Foil grabado",
};

/**
 * Manual stock entry: search any printing in the catalog (Magic or Pokemon)
 * and add copies. Pokemon stock enters only through here, since Delver Lens
 * exports are Magic-only.
 */
export function AddStockForm() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PrintingHit[]>([]);
  const [selected, setSelected] = useState<PrintingHit | null>(null);
  const [finish, setFinish] = useState("nonfoil");
  const [condition, setCondition] = useState("NM");
  const [language, setLanguage] = useState("en");
  const [quantity, setQuantity] = useState(1);
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const empty = selected || q.trim().length < 2;
    const t = setTimeout(
      async () => {
        if (empty) {
          setHits([]);
          return;
        }
        const res = await fetch(`/api/admin/printings?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        }).catch(() => null);
        if (res?.ok) setHits(await res.json());
      },
      empty ? 0 : 200,
    );
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, selected]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    const overrideNum = Number(override.replace(",", "."));
    const res = await fetch("/api/admin/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printingId: selected.printing_id,
        finish,
        condition,
        language,
        quantity,
        priceOverrideUsd:
          override.trim() !== "" && Number.isFinite(overrideNum) && overrideNum > 0
            ? overrideNum
            : null,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setDone(true);
      setSelected(null);
      setQ("");
      setQuantity(1);
      setOverride("");
      setTimeout(() => setDone(false), 2500);
      router.refresh();
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
      <h2 className="font-display text-lg font-semibold">Agregar stock manualmente</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Buscá cualquier carta del catálogo (Magic o Pokémon) y sumá copias. Para
        Pokémon el stock se carga por acá.
      </p>
      {done && (
        <p className="mt-3 rounded-lg bg-felt/10 px-4 py-2 text-sm font-medium text-felt">
          Stock agregado.
        </p>
      )}

      {!selected ? (
        <div className="relative mt-4 max-w-md">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre de la carta…"
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          {hits.length > 0 && (
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-ink/10 bg-white shadow-pop">
              {hits.map((h) => (
                <button
                  key={h.printing_id}
                  type="button"
                  onClick={() => {
                    setSelected(h);
                    setFinish(h.finishes.includes("nonfoil") ? "nonfoil" : h.finishes[0]);
                  }}
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-paper-dim"
                >
                  <span className="font-medium">{h.card_name}</span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {h.game_id === "pokemon" ? "PKM" : "MTG"} · {h.set_name} #{h.collector_number}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
          <div className="rounded-lg bg-paper-dim px-3 py-2">
            <p className="font-medium">{selected.card_name}</p>
            <p className="text-xs text-ink-faint">
              {selected.set_name} #{selected.collector_number}
            </p>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Acabado</span>
            <select
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/15 bg-white px-2 py-1.5"
            >
              {selected.finishes.map((f) => (
                <option key={f} value={f}>
                  {FINISH_LABEL[f] ?? f}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Estado</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/15 bg-white px-2 py-1.5"
            >
              {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Idioma</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/15 bg-white px-2 py-1.5"
            >
              {["en", "es", "pt", "ja", "de", "fr", "it"].map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Cantidad</span>
            <input
              type="number"
              min={1}
              max={999}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              className="mt-1 block w-20 rounded-lg border border-ink/15 px-2 py-1.5 text-right"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Precio manual (US$)</span>
            <input
              type="text"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder="opcional"
              className="mt-1 block w-24 rounded-lg border border-ink/15 px-2 py-1.5 text-right"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-felt px-4 py-2 font-semibold text-paper hover:bg-felt-soft disabled:opacity-60"
          >
            Agregar
          </button>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="rounded-lg border border-ink/15 px-3 py-2 hover:border-felt"
          >
            Cambiar carta
          </button>
        </form>
      )}
    </div>
  );
}
