import Link from "next/link";
import { sql } from "drizzle-orm";
import { AddStockForm } from "@/components/AddStockForm";
import { StockRow } from "@/components/admin/StockRow";
import { db } from "@/db";
import { M } from "@/lib/messages";
import { getPricingContext } from "@/lib/settings";
import {
  AVAILABILITY,
  STOCK_SORTS,
  listStock,
  parseStockFilters,
  stockFilterOptions,
  stockFiltersToParams,
} from "@/lib/stock-query";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.stock.title} — ${M.storeName}` };

const S = M.admin.stock;
const F = S.filters;
const FINISHES: [string, string][] = [
  ["nonfoil", M.card.nonfoil],
  ["foil", M.card.foil],
  ["etched", M.card.etched],
  ["reverse", M.card.reverse],
];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

const selectCls = "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm";

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = parseStockFilters(await searchParams);
  const { multiplier, minimumUsd } = await getPricingContext();
  const [{ rows, total, copies, pages }, options, games] = await Promise.all([
    listStock(f, multiplier),
    stockFilterOptions(),
    db.execute(sql`select id, name from games order by sort_order`),
  ]);
  const filtered = stockFiltersToParams(f, { page: 1, sort: "name" }).toString() !== "";
  const exportParams = stockFiltersToParams(f, { page: 1 });
  const pageHref = (page: number) => `/admin/stock?${stockFiltersToParams(f, { page })}`;

  return (
    <div>
      <details className="group rounded-xl border border-ink/10 bg-white">
        <summary className="cursor-pointer list-none px-5 py-3 font-display font-semibold marker:hidden">
          <span className="mr-2 inline-block transition group-open:rotate-90">›</span>
          {S.addTitle}
        </summary>
        <div className="border-t border-ink/10 px-5 pb-5">
          <AddStockForm />
        </div>
      </details>

      {/* Filters: a plain GET form, so every view is a shareable URL. */}
      <form className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-ink/10 bg-white p-4 text-xs sm:grid-cols-4 lg:grid-cols-8">
        <label className="col-span-2 block">
          <span className="font-medium">{S.card}</span>
          <input
            type="search"
            name="q"
            defaultValue={f.q}
            placeholder={S.search}
            className="mt-1 block w-full rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="font-medium">{F.game}</span>
          <select name="juego" defaultValue={f.game} className={selectCls}>
            <option value="">{F.all}</option>
            {(games.rows as { id: string; name: string }[]).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.set}</span>
          <select name="set" defaultValue={f.set} className={selectCls}>
            <option value="">{F.all}</option>
            {options.sets.map((s) => (
              <option key={`${s.code}|${s.name}`} value={s.code}>
                {s.name} ({s.code.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.finish}</span>
          <select name="acabado" defaultValue={f.finish} className={selectCls}>
            <option value="">{F.all}</option>
            {FINISHES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.condition}</span>
          <select name="estado" defaultValue={f.condition} className={selectCls}>
            <option value="">{F.all}</option>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.language}</span>
          <select name="idioma" defaultValue={f.language} className={selectCls}>
            <option value="">{F.all}</option>
            {options.languages.map((l) => (
              <option key={l} value={l}>
                {M.card.languages[l] ?? l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.availability}</span>
          <select name="disp" defaultValue={f.availability} className={selectCls}>
            {AVAILABILITY.map((a) => (
              <option key={a} value={a}>
                {F.availabilityOptions[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{F.sort}</span>
          <select name="orden" defaultValue={f.sort} className={selectCls}>
            {STOCK_SORTS.map((o) => (
              <option key={o} value={o}>
                {F.sortOptions[o]}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4 lg:col-span-8">
          <button
            type="submit"
            className="rounded-lg bg-felt px-4 py-1.5 text-sm font-semibold text-paper hover:bg-felt-soft"
          >
            {F.apply}
          </button>
          {filtered && (
            <Link href="/admin/stock" className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-dim">
              {F.clear}
            </Link>
          )}
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{S.summary(total, copies)}</p>
        <a
          href={`/api/admin/stock/export?${exportParams}`}
          title={S.exportHelp}
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium hover:border-felt"
        >
          ⬇ {S.export}
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-ink-soft">{filtered ? S.empty : S.emptyAll}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="px-3 py-3">{S.card}</th>
                <th className="px-3 py-3">{S.variant}</th>
                <th className="px-3 py-3 text-right">{S.qty}</th>
                <th className="px-3 py-3 text-right">{S.reserved}</th>
                <th className="px-3 py-3 text-right">{S.price}</th>
                <th className="px-3 py-3 text-right">{S.override}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <StockRow
                  key={r.id}
                  multiplier={multiplier}
                  minimumUsd={minimumUsd}
                  row={{
                    id: r.id,
                    cardName: r.card_name,
                    gameId: r.game_id,
                    setName: r.set_name,
                    setCode: r.set_code,
                    collectorNumber: r.collector_number,
                    finish: r.finish,
                    condition: r.condition,
                    language: r.language,
                    quantity: r.quantity,
                    reserved: r.reserved,
                    overrideUsd: r.price_override_usd,
                    referenceUsd: r.reference_usd != null ? Number(r.reference_usd) : null,
                    imageSmall: r.image_small,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm">
          {f.page > 1 && (
            <Link href={pageHref(f.page - 1)} className="rounded-lg border border-ink/15 px-3 py-1.5 hover:border-felt">
              {M.catalog.prev}
            </Link>
          )}
          <span className="text-ink-soft">{M.catalog.page(f.page, pages)}</span>
          {f.page < pages && (
            <Link href={pageHref(f.page + 1)} className="rounded-lg border border-ink/15 px-3 py-1.5 hover:border-felt">
              {M.catalog.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
