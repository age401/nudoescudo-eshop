"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogSort } from "@/lib/catalog";
import { M } from "@/lib/messages";

/**
 * URL-driven filter/sort bar for the catalog. Changing a control rewrites the
 * query string (resetting pagination); the server component re-renders with the
 * new selection.
 */
export function CatalogFilters({
  sets,
  colors,
  color,
  set,
  sort,
}: {
  sets: { code: string; name: string }[];
  colors: string[];
  color: string;
  set: string;
  sort: CatalogSort;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page"); // any filter/sort change returns to the first page
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const hasFilters = Boolean(color || set);
  const selectClass =
    "rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm";

  return (
    <div className="flex flex-wrap items-end gap-4">
      {colors.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-soft">
            {M.catalog.color}
          </span>
          <select
            value={color}
            onChange={(e) => update("color", e.target.value)}
            className={selectClass}
          >
            <option value="">{M.catalog.allColors}</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {M.catalog.colors[c] ?? c}
              </option>
            ))}
          </select>
        </label>
      )}

      {sets.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-soft">
            {M.catalog.set}
          </span>
          <select
            value={set}
            onChange={(e) => update("set", e.target.value)}
            className={`${selectClass} max-w-[16rem]`}
          >
            <option value="">{M.catalog.allSets}</option>
            {sets.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">
          {M.catalog.sort}
        </span>
        <select
          value={sort}
          onChange={(e) => update("sort", e.target.value)}
          className={selectClass}
        >
          {(
            ["name_asc", "name_desc", "price_asc", "price_desc"] as CatalogSort[]
          ).map((s) => (
            <option key={s} value={s}>
              {M.catalog.sortOptions[s]}
            </option>
          ))}
        </select>
      </label>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("color");
            params.delete("set");
            params.delete("page");
            const qs = params.toString();
            router.push(qs ? `${pathname}?${qs}` : pathname);
          }}
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm font-medium text-ink-soft hover:border-felt hover:text-ink"
        >
          {M.catalog.clear}
        </button>
      )}
    </div>
  );
}
