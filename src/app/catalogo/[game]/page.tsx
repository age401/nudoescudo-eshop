import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFilters } from "@/components/CatalogFilters";
import { getCatalog, getEnabledGames, parseCatalogSort } from "@/lib/catalog";
import { M } from "@/lib/messages";
import { formatUsd, formatUyu, usdToUyu } from "@/lib/pricing";
import { getPricingContext } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ game: string }>;
  searchParams: Promise<{
    color?: string;
    set?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const { game } = await params;
  const sp = await searchParams;

  const games = await getEnabledGames();
  const current = games.find((g) => g.id === game);
  if (!current) notFound();

  const color = sp.color ?? "";
  const set = sp.set ?? "";
  const sort = parseCatalogSort(sp.sort);
  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);

  const pricing = await getPricingContext();
  const catalog = await getCatalog({
    gameId: game,
    color: color || undefined,
    set: set || undefined,
    sort,
    page,
    multiplier: pricing.multiplier,
    minimumUsd: pricing.minimumUsd,
  });

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (color) params.set("color", color);
    if (set) params.set("set", set);
    if (sort !== "name_asc") params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/catalogo/${game}?${qs}` : `/catalogo/${game}`;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            {M.catalog.heading(M.card.game[current.id] ?? current.name)}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{M.catalog.intro}</p>
        </div>
        <p className="text-sm text-ink-faint">{M.catalog.results(catalog.total)}</p>
      </div>

      <div className="mt-6 rounded-2xl bg-paper-dim p-4">
        <CatalogFilters
          sets={catalog.sets}
          colors={catalog.colors}
          color={color}
          set={set}
          sort={sort}
        />
      </div>

      {catalog.cards.length === 0 ? (
        <p className="mt-16 text-center text-ink-soft">{M.catalog.empty}</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.cards.map((c, i) => (
            <Link
              key={c.cardId}
              href={`/carta/${c.gameId}/${c.slug}`}
              className="rise-in group"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <div className="overflow-hidden rounded-xl shadow-card transition-transform duration-200 group-hover:-translate-y-1 group-hover:rotate-[0.6deg]">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt={c.name}
                    loading="lazy"
                    className="aspect-[488/680] w-full bg-paper-dim object-cover"
                  />
                ) : (
                  <div className="flex aspect-[488/680] w-full items-center justify-center bg-paper-dim p-2 text-center text-xs text-ink-faint">
                    {c.name}
                  </div>
                )}
              </div>
              <div className="mt-2 px-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-ink-faint">{c.setName}</p>
                <p className="font-price mt-1 text-sm font-semibold text-felt">
                  {c.priceUsd != null ? (
                    <>
                      <span className="font-normal text-ink-faint">
                        {M.catalog.fromPrice}{" "}
                      </span>
                      {formatUsd(c.priceUsd)}
                      {pricing.fxRate && (
                        <span className="ml-1 font-normal text-ink-faint">
                          ≈ {formatUyu(usdToUyu(c.priceUsd, pricing.fxRate))}
                        </span>
                      )}
                    </>
                  ) : (
                    M.card.noPrice
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {catalog.pageCount > 1 && (
        <div className="mt-10 flex items-center justify-center gap-4">
          {catalog.page > 1 ? (
            <Link
              href={pageHref(catalog.page - 1)}
              className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium hover:border-felt"
            >
              ← {M.catalog.prev}
            </Link>
          ) : (
            <span className="rounded-lg border border-ink/10 px-4 py-2 text-sm font-medium text-ink-faint/60">
              ← {M.catalog.prev}
            </span>
          )}
          <span className="text-sm text-ink-soft">
            {M.catalog.page(catalog.page, catalog.pageCount)}
          </span>
          {catalog.page < catalog.pageCount ? (
            <Link
              href={pageHref(catalog.page + 1)}
              className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium hover:border-felt"
            >
              {M.catalog.next} →
            </Link>
          ) : (
            <span className="rounded-lg border border-ink/10 px-4 py-2 text-sm font-medium text-ink-faint/60">
              {M.catalog.next} →
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const games = await getEnabledGames();
  const current = games.find((g) => g.id === game);
  return {
    title: current
      ? `${M.catalog.heading(current.name)} — ${M.storeName}`
      : M.catalog.title,
  };
}
