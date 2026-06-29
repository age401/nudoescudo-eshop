import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, games, prices, printings, stock } from "@/db/schema";
import { normalizeName } from "@/lib/normalize";
import { computeUnitPriceUsd } from "@/lib/pricing";

export type Suggestion = {
  cardId: string;
  name: string;
  slug: string;
  gameId: string;
  gameName: string;
  available: number;
};

/**
 * Jumplist suggestions: substring + fuzzy match over all cards of enabled
 * games (stocked or not), grouped by game by the caller. `available` is the
 * sellable quantity across all printings (0 = grayed out in the UI).
 */
export async function suggestCards(query: string, limitPerGame = 8): Promise<Suggestion[]> {
  const q = normalizeName(query);
  if (q.length < 2) return [];

  const rows = await db.execute(sql`
    with matches as (
      select c.id, c.game_id, c.name, c.slug, c.normalized_name,
             (c.normalized_name like ${q + "%"}) as is_prefix,
             similarity(c.normalized_name, ${q}) as sim
      from cards c
      where c.normalized_name like ${"%" + q + "%"}
         or c.normalized_name % ${q}
    ),
    ranked as (
      select m.*, row_number() over (
        partition by m.game_id
        order by m.is_prefix desc, m.sim desc, length(m.normalized_name), m.name
      ) as rn
      from matches m
    )
    select r.id as card_id, r.name, r.slug, r.game_id, g.name as game_name,
           g.sort_order,
           coalesce((
             select sum(st.quantity - st.reserved)
             from printings p
             join stock st on st.printing_id = p.id
             where p.card_id = r.id
           ), 0)::int as available
    from ranked r
    join games g on g.id = r.game_id and g.enabled
    where r.rn <= ${limitPerGame}
    order by g.sort_order, r.rn
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    cardId: r.card_id as string,
    name: r.name as string,
    slug: r.slug as string,
    gameId: r.game_id as string,
    gameName: r.game_name as string,
    available: r.available as number,
  }));
}

export type FeaturedCard = {
  cardId: string;
  name: string;
  slug: string;
  gameId: string;
  setName: string;
  imageUrl: string | null;
  finish: string;
  available: number;
  referenceUsd: number | null;
  overrideUsd: number | null;
};

/** Recently (re)stocked cards for the home page grid. One entry per card. */
export async function getFeaturedStock(limit = 12): Promise<FeaturedCard[]> {
  const rows = await db.execute(sql`
    select distinct on (c.id)
      c.id as card_id, c.name, c.slug, c.game_id,
      p.set_name, p.image_uris->>'normal' as image_url,
      st.finish, (st.quantity - st.reserved)::int as available,
      pr.price_usd, st.price_override_usd,
      st.updated_at
    from stock st
    join printings p on p.id = st.printing_id
    join cards c on c.id = p.card_id
    join games g on g.id = c.game_id and g.enabled
    left join prices pr on pr.printing_id = st.printing_id and pr.finish = st.finish
    where st.quantity - st.reserved > 0
    order by c.id, st.updated_at desc
    limit ${limit * 3}
  `);
  return (rows.rows as Record<string, unknown>[])
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, limit)
    .map((r) => ({
      cardId: r.card_id as string,
      name: r.name as string,
      slug: r.slug as string,
      gameId: r.game_id as string,
      setName: r.set_name as string,
      imageUrl: (r.image_url as string) ?? null,
      finish: r.finish as string,
      available: r.available as number,
      referenceUsd: r.price_usd != null ? Number(r.price_usd) : null,
      overrideUsd: r.price_override_usd != null ? Number(r.price_override_usd) : null,
    }));
}

export type StockEntry = {
  stockId: string;
  finish: string;
  condition: string;
  language: string;
  available: number;
  priceOverrideUsd: number | null;
};

export type PrintingDetail = {
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string | null;
  imageUris: Record<string, string> | null;
  finishes: string[];
  releasedAt: string | null;
  /** Reference USD price per finish, from Card Kingdom. */
  referencePrices: Record<string, number>;
  stock: StockEntry[];
};

export type CardDetail = {
  cardId: string;
  name: string;
  slug: string;
  gameId: string;
  gameName: string;
  printings: PrintingDetail[];
};

/** Full card page payload: every printing, with prices and sellable stock. */
export async function getCardBySlug(gameId: string, slug: string): Promise<CardDetail | null> {
  const card = await db
    .select({
      id: cards.id,
      name: cards.name,
      slug: cards.slug,
      gameId: cards.gameId,
      gameName: games.name,
    })
    .from(cards)
    .innerJoin(games, eq(games.id, cards.gameId))
    .where(and(eq(cards.gameId, gameId), eq(cards.slug, slug)))
    .limit(1);
  if (!card.length) return null;
  const c = card[0];

  const prints = await db
    .select()
    .from(printings)
    .where(eq(printings.cardId, c.id))
    .orderBy(asc(printings.releasedAt));

  const printingIds = prints.map((p) => p.id);
  const priceRows = printingIds.length
    ? await db.select().from(prices).where(sql`${prices.printingId} in ${printingIds}`)
    : [];
  const stockRows = printingIds.length
    ? await db.select().from(stock).where(sql`${stock.printingId} in ${printingIds}`)
    : [];

  const detail: CardDetail = {
    cardId: c.id,
    name: c.name,
    slug: c.slug,
    gameId: c.gameId,
    gameName: c.gameName,
    printings: prints.map((p) => ({
      printingId: p.id,
      setCode: p.setCode,
      setName: p.setName,
      collectorNumber: p.collectorNumber,
      rarity: p.rarity,
      imageUris: p.imageUris,
      finishes: p.finishes,
      releasedAt: p.releasedAt,
      referencePrices: Object.fromEntries(
        priceRows
          .filter((pr) => pr.printingId === p.id)
          .map((pr) => [pr.finish, Number(pr.priceUsd)]),
      ),
      stock: stockRows
        .filter((s) => s.printingId === p.id && s.quantity - s.reserved > 0)
        .map((s) => ({
          stockId: s.id,
          finish: s.finish,
          condition: s.condition,
          language: s.language,
          available: s.quantity - s.reserved,
          priceOverrideUsd: s.priceOverrideUsd ? Number(s.priceOverrideUsd) : null,
        })),
    })),
  };
  return detail;
}

// ---------------------------------------------------------------------------
// Catalog browse (in-stock cards, filterable + sortable)
// ---------------------------------------------------------------------------

export type CatalogSort = "name_asc" | "name_desc" | "price_asc" | "price_desc";

const CATALOG_SORTS: CatalogSort[] = [
  "name_asc",
  "name_desc",
  "price_asc",
  "price_desc",
];

export function parseCatalogSort(value: string | undefined): CatalogSort {
  return CATALOG_SORTS.includes(value as CatalogSort)
    ? (value as CatalogSort)
    : "name_asc";
}

/** MTG colors lead the filter; other games' codes (e.g. Pokemon types) follow. */
const MTG_COLOR_ORDER = ["W", "U", "B", "R", "G"];

/**
 * Order the color codes present in stock: MTG WUBRG first, then any other
 * real codes alphabetically, then the synthetic "colorless" (C) and
 * "multicolor" (M) buckets last.
 */
function orderColors(present: Set<string>): string[] {
  const real = [...present]
    .filter((c) => c !== "C" && c !== "M")
    .sort((a, b) => {
      const ia = MTG_COLOR_ORDER.indexOf(a);
      const ib = MTG_COLOR_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a.localeCompare(b);
    });
  if (present.has("C")) real.push("C");
  if (present.has("M")) real.push("M");
  return real;
}

function matchesColor(cardColors: string[], code: string): boolean {
  if (code === "C") return cardColors.length === 0;
  if (code === "M") return cardColors.length >= 2;
  return cardColors.includes(code);
}

export type CatalogCard = {
  cardId: string;
  name: string;
  slug: string;
  gameId: string;
  setName: string;
  imageUrl: string | null;
  colors: string[];
  available: number;
  /** Cheapest sellable price across the card's in-stock variants. */
  priceUsd: number | null;
};

export type CatalogResult = {
  cards: CatalogCard[];
  total: number;
  page: number;
  pageCount: number;
  /** Filter options present in stock for this game (stable across selection). */
  sets: { code: string; name: string }[];
  colors: string[];
};

type CatalogRow = {
  card_id: string;
  name: string;
  slug: string;
  game_id: string;
  colors: unknown;
  set_code: string;
  set_name: string;
  image_normal: string | null;
  image_small: string | null;
  released_at: string | null;
  available: number;
  price_override_usd: string | null;
  reference_usd: string | null;
};

/**
 * Browse the catalog of a game: one tile per card that has sellable stock,
 * with color/set filters and name/price sorting. Aggregation happens in JS
 * because the in-stock set is the shop's inventory (small), and the price
 * floor logic lives in computeUnitPriceUsd.
 */
export async function getCatalog(args: {
  gameId: string;
  color?: string;
  set?: string;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
  multiplier: number;
  minimumUsd: number;
}): Promise<CatalogResult> {
  const pageSize = args.pageSize ?? 36;
  const sort = args.sort ?? "name_asc";

  const result = await db.execute(sql`
    select
      c.id as card_id, c.name, c.slug, c.game_id, c.colors,
      p.set_code, p.set_name,
      p.image_uris->>'normal' as image_normal,
      p.image_uris->>'small' as image_small,
      p.released_at,
      (st.quantity - st.reserved)::int as available,
      st.price_override_usd,
      pr.price_usd as reference_usd
    from stock st
    join printings p on p.id = st.printing_id
    join cards c on c.id = p.card_id
    join games g on g.id = c.game_id and g.enabled
    left join prices pr
      on pr.printing_id = st.printing_id and pr.finish = st.finish
    where c.game_id = ${args.gameId} and st.quantity - st.reserved > 0
  `);
  const rows = result.rows as unknown as CatalogRow[];

  // Filter options come from the full in-stock set, so they stay stable no
  // matter what is currently selected.
  const setMap = new Map<string, string>();
  const presentColors = new Set<string>();
  for (const r of rows) {
    setMap.set(r.set_code, r.set_name);
    const cc = Array.isArray(r.colors) ? (r.colors as string[]) : [];
    if (cc.length === 0) presentColors.add("C");
    if (cc.length >= 2) presentColors.add("M");
    for (const c of cc) presentColors.add(c);
  }
  const sets = [...setMap.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const colors = orderColors(presentColors);

  // Aggregate rows into one entry per card, honouring the set filter (which
  // narrows price/availability to that edition).
  const byCard = new Map<
    string,
    {
      card: Omit<CatalogCard, "available" | "priceUsd">;
      available: number;
      price: number | null;
      released: string | null;
    }
  >();

  for (const r of rows) {
    if (args.set && r.set_code !== args.set) continue;
    const cc = Array.isArray(r.colors) ? (r.colors as string[]) : [];
    const price = computeUnitPriceUsd({
      referenceUsd: r.reference_usd != null ? Number(r.reference_usd) : null,
      overrideUsd: r.price_override_usd != null ? Number(r.price_override_usd) : null,
      multiplier: args.multiplier,
      minimumUsd: args.minimumUsd,
    });
    const image = r.image_normal ?? r.image_small ?? null;

    const existing = byCard.get(r.card_id);
    if (!existing) {
      byCard.set(r.card_id, {
        card: {
          cardId: r.card_id,
          name: r.name,
          slug: r.slug,
          gameId: r.game_id,
          colors: cc,
          setName: r.set_name,
          imageUrl: image,
        },
        available: r.available,
        price,
        released: r.released_at,
      });
      continue;
    }
    existing.available += r.available;
    // Representative tile = the cheapest priced variant; fall back to the
    // most recently released when nothing is priced yet.
    const cheaper = price != null && (existing.price == null || price < existing.price);
    const newerUnpriced =
      price == null &&
      existing.price == null &&
      (r.released_at ?? "") > (existing.released ?? "");
    if (cheaper || newerUnpriced) {
      existing.price = price;
      existing.released = r.released_at;
      existing.card.setName = r.set_name;
      existing.card.imageUrl = image ?? existing.card.imageUrl;
    } else if (existing.card.imageUrl == null && image != null) {
      existing.card.imageUrl = image;
    }
  }

  const list: CatalogCard[] = [...byCard.values()]
    .filter((e) => !args.color || matchesColor(e.card.colors, args.color))
    .map((e) => ({ ...e.card, available: e.available, priceUsd: e.price }));

  list.sort((a, b) => {
    switch (sort) {
      case "name_desc":
        return b.name.localeCompare(a.name, "es");
      case "price_asc":
      case "price_desc": {
        // Cards without a price always sort to the end.
        const ap = a.priceUsd;
        const bp = b.priceUsd;
        if (ap == null && bp == null) return a.name.localeCompare(b.name, "es");
        if (ap == null) return 1;
        if (bp == null) return -1;
        return sort === "price_asc" ? ap - bp : bp - ap;
      }
      case "name_asc":
      default:
        return a.name.localeCompare(b.name, "es");
    }
  });

  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(args.page ?? 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  const pageCards = list.slice(start, start + pageSize);

  return { cards: pageCards, total, page, pageCount, sets, colors };
}

/** Enabled games for the catalog chooser, in display order. */
export async function getEnabledGames(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: games.id, name: games.name })
    .from(games)
    .where(eq(games.enabled, true))
    .orderBy(asc(games.sortOrder));
}

/**
 * Best-effort: fill in a Pokemon card's energy types (its catalog "colors")
 * from TCGdex. Pokemon types aren't in the bulk set listing the catalog sync
 * uses, so we fetch them lazily — when a Pokemon card is first stocked, which
 * is exactly when it starts mattering for the in-stock catalog. MTG already
 * gets colors during the Scryfall sync, so this is a no-op there.
 */
export async function ensurePokemonCardColors(printingId: string): Promise<void> {
  const [row] = await db
    .select({
      cardId: cards.id,
      gameId: cards.gameId,
      colors: cards.colors,
      externalId: printings.externalId,
    })
    .from(printings)
    .innerJoin(cards, eq(cards.id, printings.cardId))
    .where(eq(printings.id, printingId))
    .limit(1);
  if (!row || row.gameId !== "pokemon" || row.colors.length > 0) return;

  const tcgdexId = row.externalId.replace(/^tcgdex:/, "");
  const { fetchJson } = await import("@/lib/download");
  const card = await fetchJson<{ types?: string[] }>(
    `https://api.tcgdex.net/v2/en/cards/${tcgdexId}`,
  );
  const types = card.types ?? [];
  if (types.length > 0) {
    await db.update(cards).set({ colors: types }).where(eq(cards.id, row.cardId));
  }
}
