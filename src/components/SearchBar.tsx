"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { M } from "@/lib/messages";

type Suggestion = {
  cardId: string;
  name: string;
  slug: string;
  gameId: string;
  gameName: string;
  available: number;
};

/**
 * Search-as-you-type with a jumplist dropdown grouped by TCG. Every card of
 * the catalog is suggested; out-of-stock entries are grayed out, stocked ones
 * show the available quantity.
 */
export function SearchBar({ variant }: { variant: "header" | "hero" }) {
  const router = useRouter();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  // Debounced fetch; ignores out-of-order responses.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data: Suggestion[] = await res.json();
          setResults(data);
          setActive(-1);
          setOpen(true);
        }
      } catch {
        // aborted or offline: keep previous results
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  // Close when clicking outside.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(s: Suggestion) {
    setOpen(false);
    setQuery("");
    router.push(`/carta/${s.gameId}/${s.slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Group consecutive results by game for section headers.
  const groups: { gameId: string; gameName: string; items: { s: Suggestion; index: number }[] }[] = [];
  results.forEach((s, index) => {
    const last = groups[groups.length - 1];
    if (last && last.gameId === s.gameId) last.items.push({ s, index });
    else groups.push({ gameId: s.gameId, gameName: s.gameName, items: [{ s, index }] });
  });

  const isHero = variant === "hero";

  return (
    <div ref={rootRef} className="relative">
      <div
        className={
          isHero
            ? "flex items-center gap-3 rounded-2xl border-2 border-felt/20 bg-white px-5 py-4 shadow-pop focus-within:border-felt"
            : "flex items-center gap-2 rounded-full bg-paper/15 px-4 py-2 text-paper focus-within:bg-paper focus-within:text-ink transition-colors"
        }
      >
        <svg
          viewBox="0 0 24 24"
          className={isHero ? "h-6 w-6 text-felt" : "h-4 w-4 opacity-70"}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.8-3.8" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={M.search.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          className={
            isHero
              ? "w-full bg-transparent text-lg outline-none placeholder:text-ink-faint"
              : "w-full bg-transparent text-sm outline-none placeholder:text-current placeholder:opacity-60"
          }
        />
        {loading && (
          <span
            className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${isHero ? "text-felt" : "opacity-70"}`}
            aria-label={M.search.searching}
          />
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-2 max-h-[28rem] overflow-y-auto rounded-xl border border-ink/10 bg-white text-ink shadow-pop"
        >
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">
              {M.search.noResults}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.gameId}>
                <p className="font-display sticky top-0 border-b border-ink/5 bg-paper-dim/95 px-4 py-1.5 text-xs font-semibold italic text-ink-soft backdrop-blur">
                  en {g.gameName}
                </p>
                {g.items.map(({ s, index }) => {
                  const out = s.available <= 0;
                  return (
                    <button
                      key={s.cardId}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(s)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
                        index === active ? "bg-foil-soft/60" : ""
                      }`}
                    >
                      <span className={out ? "text-ink-faint" : "font-medium"}>
                        {s.name}
                      </span>
                      {out ? (
                        <span className="shrink-0 text-xs text-ink-faint">
                          {M.search.outOfStock}
                        </span>
                      ) : (
                        <span className="font-price shrink-0 rounded-full bg-felt px-2 py-0.5 text-xs font-medium text-paper">
                          {M.search.inStock(s.available)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
