"use client";

import { useEffect, useMemo, useState } from "react";
import { M } from "@/lib/messages";
import { formatUsd } from "@/lib/pricing";

export type AdminOrderItem = {
  id: string;
  cardName: string;
  setName: string;
  collectorNumber: string | null;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
  unitPriceUsd: number;
  imageUrl: string | null;
  /** Card colors (MTG color identity letters, or another game's type codes). */
  colors: string[];
  /** Converted mana cost; null for games without one, or before a re-sync. */
  manaValue: number | null;
};

export type ItemSort = "color_mv" | "mv" | "name" | "price" | "set";

const SORTS: ItemSort[] = ["color_mv", "mv", "name", "price", "set"];
const VIEWS = ["list", "grid"] as const;
type View = (typeof VIEWS)[number];

const PREFS_KEY = "ne_admin_order_items";

/** WUBRG, then any other game's single types, then gold, then colorless. */
const MTG_COLOR_ORDER = ["W", "U", "B", "R", "G"];

function colorBucket(colors: string[]): { rank: number; code: string } {
  if (colors.length === 0) return { rank: 7, code: "C" };
  if (colors.length > 1) return { rank: 6, code: "M" };
  const code = colors[0];
  const i = MTG_COLOR_ORDER.indexOf(code);
  return i === -1 ? { rank: 5, code } : { rank: i, code };
}

function byName(a: AdminOrderItem, b: AdminOrderItem): number {
  return a.cardName.localeCompare(b.cardName, "es");
}

/** Null mana values sort last — they are unknown, not zero. */
function byManaValue(a: AdminOrderItem, b: AdminOrderItem): number {
  const av = a.manaValue ?? Number.POSITIVE_INFINITY;
  const bv = b.manaValue ?? Number.POSITIVE_INFINITY;
  return av - bv;
}

function comparator(sort: ItemSort) {
  return (a: AdminOrderItem, b: AdminOrderItem): number => {
    switch (sort) {
      case "color_mv": {
        const ca = colorBucket(a.colors);
        const cb = colorBucket(b.colors);
        return (
          ca.rank - cb.rank ||
          ca.code.localeCompare(cb.code) ||
          byManaValue(a, b) ||
          byName(a, b)
        );
      }
      case "mv":
        return byManaValue(a, b) || byName(a, b);
      case "price":
        return b.unitPriceUsd * b.quantity - a.unitPriceUsd * a.quantity || byName(a, b);
      case "set":
        return a.setName.localeCompare(b.setName, "es") || byName(a, b);
      default:
        return byName(a, b);
    }
  };
}

function variantLine(i: AdminOrderItem): string {
  const finish = i.finish === "nonfoil" ? M.card.nonfoil : i.finish;
  return `${finish} · ${i.condition} · ${i.language.toUpperCase()}`;
}

function manaLabel(i: AdminOrderItem): string {
  return i.manaValue == null ? "—" : String(i.manaValue);
}

/**
 * The cards of an order, sortable (Color > mana value by default) and
 * viewable as a list or as a grid of small previews. Preferences are kept
 * per browser so the admin does not re-pick them on every order.
 */
export function AdminOrderItems({ items }: { items: AdminOrderItem[] }) {
  const [sort, setSort] = useState<ItemSort>("color_mv");
  const [view, setView] = useState<View>("list");
  const [hydrated, setHydrated] = useState(false);
  const O = M.admin.orders;

  // The microtask keeps the state updates out of the synchronous effect
  // body (react-hooks lint), matching how the cart hydrates.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (SORTS.includes(p.sort)) setSort(p.sort);
          if (VIEWS.includes(p.view)) setView(p.view);
        }
      } catch {
        // no stored preference: keep the defaults
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, view }));
    } catch {
      // storage unavailable (private mode): preferences just don't persist
    }
  }, [sort, view, hydrated]);

  const sorted = useMemo(() => [...items].sort(comparator(sort)), [items, sort]);

  return (
    <div className="rounded-xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-4 py-3">
        <p className="mr-auto text-sm font-semibold">{O.items}</p>

        <label className="flex items-center gap-2 text-xs text-ink-faint">
          {O.sort}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ItemSort)}
            className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs text-ink"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {O.sortOptions[s]}
              </option>
            ))}
          </select>
        </label>

        <div
          role="group"
          aria-label={O.view}
          className="inline-flex rounded-lg border border-ink/15 p-0.5"
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v ? "bg-felt text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v === "list" ? O.viewList : O.viewGrid}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <ul className="divide-y divide-ink/5">
          {sorted.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3">
              {i.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.imageUrl} alt="" className="w-10 rounded shadow-card" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.cardName}</p>
                <p className="text-xs text-ink-faint">
                  {i.setName} · {variantLine(i)}
                </p>
              </div>
              <span
                title={O.manaValue}
                className="font-price w-10 text-right text-xs text-ink-faint"
              >
                {manaLabel(i)}
              </span>
              <span className="font-price text-sm">× {i.quantity}</span>
              <span className="font-price w-24 text-right text-sm font-semibold">
                {formatUsd(i.unitPriceUsd * i.quantity)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3 p-4">
          {sorted.map((i) => (
            <li key={i.id} className="min-w-0">
              <div className="relative">
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.imageUrl}
                    alt={i.cardName}
                    title={`${i.cardName} — ${i.setName} · ${variantLine(i)}`}
                    className="aspect-[488/680] w-full rounded-md bg-paper-dim object-cover shadow-card"
                  />
                ) : (
                  <div className="flex aspect-[488/680] w-full items-center justify-center rounded-md bg-paper-dim p-1 text-center text-[10px] text-ink-faint">
                    {i.cardName}
                  </div>
                )}
                {i.quantity > 1 && (
                  <span className="font-price absolute right-1 top-1 rounded-full bg-felt px-1.5 py-0.5 text-[10px] font-semibold text-paper">
                    ×{i.quantity}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-[11px] font-medium" title={i.cardName}>
                {i.cardName}
              </p>
              <p className="font-price truncate text-[10px] text-ink-faint">
                {i.condition} · {formatUsd(i.unitPriceUsd * i.quantity)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
