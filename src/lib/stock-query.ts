/**
 * Admin stock listing: filters, sort and paging shared by the stock table and
 * the CSV export, so "export" always downloads exactly what is on screen
 * (minus paging).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { normalizeName } from "@/lib/normalize";

export const STOCK_PAGE_SIZE = 50;

export const AVAILABILITY = ["all", "available", "out", "reserved"] as const;
export const STOCK_SORTS = ["name", "set", "qty", "price", "updated"] as const;

export type StockFilters = {
  q: string;
  game: string; // '' = all
  set: string; // set code, '' = all
  finish: string;
  language: string;
  condition: string;
  availability: (typeof AVAILABILITY)[number];
  sort: (typeof STOCK_SORTS)[number];
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseStockFilters(params: Raw): StockFilters {
  const availability = one(params.disp) as StockFilters["availability"];
  const sort = one(params.orden) as StockFilters["sort"];
  return {
    q: one(params.q),
    game: one(params.juego),
    set: one(params.set).toLowerCase(),
    finish: one(params.acabado),
    language: one(params.idioma),
    condition: one(params.estado).toUpperCase(),
    availability: AVAILABILITY.includes(availability) ? availability : "all",
    sort: STOCK_SORTS.includes(sort) ? sort : "name",
    page: Math.max(parseInt(one(params.pag), 10) || 1, 1),
  };
}

/** Back to URL params (only non-defaults), for links and the export. */
export function stockFiltersToParams(f: StockFilters, overrides: Partial<StockFilters> = {}) {
  const v = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  if (v.game) p.set("juego", v.game);
  if (v.set) p.set("set", v.set);
  if (v.finish) p.set("acabado", v.finish);
  if (v.language) p.set("idioma", v.language);
  if (v.condition) p.set("estado", v.condition);
  if (v.availability !== "all") p.set("disp", v.availability);
  if (v.sort !== "name") p.set("orden", v.sort);
  if (v.page > 1) p.set("pag", String(v.page));
  return p;
}

export type StockListRow = {
  id: string;
  printing_id: string;
  external_id: string;
  game_id: string;
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
  reserved: number;
  price_override_usd: string | null;
  reference_usd: string | null;
  updated_at: string;
  image_small: string | null;
};

function where(f: StockFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.q) parts.push(sql`c.normalized_name like ${`%${normalizeName(f.q)}%`}`);
  if (f.game) parts.push(sql`c.game_id = ${f.game}`);
  if (f.set) parts.push(sql`lower(p.set_code) = ${f.set}`);
  if (f.finish) parts.push(sql`s.finish = ${f.finish}`);
  if (f.language) parts.push(sql`s.language = ${f.language}`);
  if (f.condition) parts.push(sql`s.condition = ${f.condition}`);
  if (f.availability === "available") parts.push(sql`s.quantity - s.reserved > 0`);
  if (f.availability === "out") parts.push(sql`s.quantity - s.reserved <= 0`);
  if (f.availability === "reserved") parts.push(sql`s.reserved > 0`);
  return sql.join(parts, sql` and `);
}

function orderBy(f: StockFilters, multiplier: number): SQL {
  switch (f.sort) {
    case "set":
      return sql`p.set_name, c.name, p.collector_number, s.finish, s.condition`;
    case "qty":
      return sql`s.quantity desc, c.name`;
    case "price":
      return sql`coalesce(s.price_override_usd, pr.price_usd * ${multiplier}) desc nulls last, c.name`;
    case "updated":
      return sql`s.updated_at desc, c.name`;
    default:
      return sql`c.name, p.set_name, p.collector_number, s.finish, s.condition, s.language`;
  }
}

const FROM = sql`
  from stock s
  join printings p on p.id = s.printing_id
  join cards c on c.id = p.card_id
  left join prices pr on pr.printing_id = s.printing_id and pr.finish = s.finish
`;

const COLUMNS = sql`
  s.id, s.printing_id, p.external_id, c.game_id, c.name as card_name,
  p.set_code, p.set_name, p.collector_number,
  s.finish, s.condition, s.language, s.quantity, s.reserved,
  s.price_override_usd, pr.price_usd as reference_usd, s.updated_at,
  p.image_uris->>'small' as image_small
`;

export async function listStock(f: StockFilters, multiplier: number) {
  const [{ total, copies }] = (
    await db.execute(sql`
      select count(*)::int as total, coalesce(sum(s.quantity), 0)::int as copies
      ${FROM} where ${where(f)}
    `)
  ).rows as { total: number; copies: number }[];
  const rows = (
    await db.execute(sql`
      select ${COLUMNS} ${FROM} where ${where(f)}
      order by ${orderBy(f, multiplier)}
      limit ${STOCK_PAGE_SIZE} offset ${(f.page - 1) * STOCK_PAGE_SIZE}
    `)
  ).rows as StockListRow[];
  return { rows, total, copies, pages: Math.max(Math.ceil(total / STOCK_PAGE_SIZE), 1) };
}

/** Every matching row, for the CSV export. */
export async function allStock(f: StockFilters, multiplier: number) {
  return (
    await db.execute(sql`
      select ${COLUMNS} ${FROM} where ${where(f)}
      order by ${orderBy(f, multiplier)}
    `)
  ).rows as StockListRow[];
}

/** Options for the filter dropdowns: only values that exist in stock. */
export async function stockFilterOptions() {
  const [sets, languages] = await Promise.all([
    db.execute(sql`
      select distinct lower(p.set_code) as code, p.set_name as name
      from stock s join printings p on p.id = s.printing_id
      order by p.set_name
    `),
    db.execute(sql`select distinct language from stock order by language`),
  ]);
  return {
    sets: sets.rows as { code: string; name: string }[],
    languages: (languages.rows as { language: string }[]).map((r) => r.language),
  };
}
