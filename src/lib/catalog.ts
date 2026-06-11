import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, games, prices, printings, stock } from "@/db/schema";
import { normalizeName } from "@/lib/normalize";

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
