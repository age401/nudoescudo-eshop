/**
 * Delver Lens CSV import. The recommended export from the app includes a
 * Scryfall ID column, which makes matching exact. Column order is whatever
 * the user configured, so columns are detected by header name.
 *
 * Modes:
 *  - merge   : add quantities to existing stock rows
 *  - replace : replace ALL stock with the file (orders' reservations are kept
 *              only if the same stock rows still exist)
 */
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, orderItems, printings, stock } from "@/db/schema";

/**
 * Delver Lens only tracks Magic. Replace mode must therefore leave stock of
 * other games (Pokemon, entered by hand) alone — otherwise every import would
 * wipe inventory the file could never describe.
 */
export const DELVER_GAME_ID = "mtg";

/** Stock rows that a Delver export is authoritative over. */
const delverScope = sql`
  ${stock.printingId} in (
    select ${printings.id}
    from ${printings}
    join ${cards} on ${cards.id} = ${printings.cardId}
    where ${cards.gameId} = ${DELVER_GAME_ID}
  )
`;

export type DelverRow = {
  scryfallId: string;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  name?: string;
};

export type ImportPreview = {
  rows: DelverRow[];
  matched: { row: DelverRow; printingId: string; cardName: string; setName: string }[];
  unmatched: DelverRow[];
};

export type ImportResult = {
  mode: "merge" | "replace";
  imported: number;
  unmatched: number;
  stockRows: number;
};

const CONDITION_MAP: Record<string, string> = {
  m: "NM", mint: "NM", nm: "NM", "near mint": "NM", "near-mint": "NM",
  ex: "LP", excellent: "LP", lp: "LP", sp: "LP", "lightly played": "LP",
  "light played": "LP", "slightly played": "LP",
  gd: "MP", good: "MP", mp: "MP", played: "MP", "moderately played": "MP",
  hp: "HP", "heavily played": "HP",
  dmg: "DMG", damaged: "DMG", poor: "DMG",
};

const LANGUAGE_MAP: Record<string, string> = {
  english: "en", en: "en",
  spanish: "es", español: "es", espanol: "es", es: "es",
  portuguese: "pt", português: "pt", pt: "pt",
  japanese: "ja", jp: "ja", ja: "ja",
  german: "de", de: "de",
  french: "fr", fr: "fr",
  italian: "it", it: "it",
  korean: "ko", ko: "ko",
  russian: "ru", ru: "ru",
  "chinese simplified": "zhs", zhs: "zhs",
  "chinese traditional": "zht", zht: "zht",
};

function normalizeCondition(v: string): string {
  return CONDITION_MAP[v.trim().toLowerCase()] ?? "NM";
}

function normalizeLanguage(v: string): string {
  return LANGUAGE_MAP[v.trim().toLowerCase()] ?? (v.trim() || "en").toLowerCase();
}

function isFoil(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s !== "" && s !== "normal" && s !== "no" && s !== "false" && s !== "0";
}

/** Parse the CSV text into normalized rows (no DB access). */
export function parseDelverCsv(text: string): DelverRow[] {
  const records: Record<string, string>[] = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    relax_column_count: true,
    // Delver's CSV export sometimes emits fields with embedded quotes (e.g.
    // artist nicknames like `Josiah ""Jo"" Cameron`) without wrapping the
    // whole field in an outer pair, which is invalid strict CSV.
    relax_quotes: true,
    bom: true,
  });

  function findKey(keys: string[], ...needles: string[]): string | null {
    for (const n of needles) {
      const k = keys.find((key) => key.includes(n));
      if (k) return k;
    }
    return null;
  }

  if (!records.length) return [];
  const keys = Object.keys(records[0]);
  const kScryfall = findKey(keys, "scryfall");
  const kQty = findKey(keys, "quantity", "count", "cantidad", "qty");
  const kFoil = findKey(keys, "foil");
  const kCond = findKey(keys, "condition", "estado");
  const kLang = findKey(keys, "language", "idioma", "lang");
  const kName = findKey(keys, "name", "nombre", "card");

  if (!kScryfall) {
    throw new Error(
      "El CSV no tiene columna de Scryfall ID. En Delver Lens, exportá incluyendo el campo 'Scryfall ID'.",
    );
  }

  return records
    .map((r) => ({
      scryfallId: (r[kScryfall] ?? "").trim(),
      quantity: Math.max(parseInt(kQty ? r[kQty] : "1", 10) || 1, 1),
      foil: kFoil ? isFoil(r[kFoil] ?? "") : false,
      condition: normalizeCondition(kCond ? (r[kCond] ?? "") : ""),
      language: normalizeLanguage(kLang ? (r[kLang] ?? "") : ""),
      name: kName ? r[kName] : undefined,
    }))
    .filter((r) => r.scryfallId.length > 0);
}

/** Match rows against the catalog without writing anything (dry-run). */
export async function previewDelverImport(text: string): Promise<ImportPreview> {
  const rows = parseDelverCsv(text);
  const ids = [...new Set(rows.map((r) => r.scryfallId))];
  const found = ids.length
    ? await db
        .select({
          printingId: printings.id,
          externalId: printings.externalId,
          setName: printings.setName,
        })
        .from(printings)
        .where(sql`${printings.externalId} in ${ids}`)
    : [];
  const byExternal = new Map(found.map((f) => [f.externalId, f]));

  const matched: ImportPreview["matched"] = [];
  const unmatched: DelverRow[] = [];
  for (const row of rows) {
    const hit = byExternal.get(row.scryfallId);
    if (hit) {
      matched.push({
        row,
        printingId: hit.printingId,
        cardName: row.name ?? "",
        setName: hit.setName,
      });
    } else {
      unmatched.push(row);
    }
  }
  return { rows, matched, unmatched };
}

/** Apply the import. Aggregates duplicate rows in the file first. */
export async function applyDelverImport(
  text: string,
  mode: "merge" | "replace",
): Promise<ImportResult> {
  const preview = await previewDelverImport(text);

  // Aggregate by (printing, finish, condition, language).
  const agg = new Map<string, { printingId: string; row: DelverRow; qty: number }>();
  for (const m of preview.matched) {
    const finish = m.row.foil ? "foil" : "nonfoil";
    const key = `${m.printingId}|${finish}|${m.row.condition}|${m.row.language}`;
    const cur = agg.get(key);
    if (cur) cur.qty += m.row.quantity;
    else agg.set(key, { printingId: m.printingId, row: m.row, qty: m.row.quantity });
  }

  await db.transaction(async (tx) => {
    if (mode === "replace") {
      // Reset quantities to 0 (keeps rows referenced by order_items intact),
      // then set the new quantities below. Scoped to the game Delver exports.
      await tx
        .update(stock)
        .set({ quantity: 0, updatedAt: new Date() })
        .where(delverScope);
    }
    for (const { printingId, row, qty } of agg.values()) {
      const finish = row.foil ? "foil" : "nonfoil";
      await tx
        .insert(stock)
        .values({
          printingId,
          finish,
          condition: row.condition,
          language: row.language,
          quantity: qty,
        })
        .onConflictDoUpdate({
          target: [stock.printingId, stock.finish, stock.condition, stock.language],
          set: {
            quantity:
              mode === "replace"
                ? sql`${qty}`
                : sql`${stock.quantity} + ${qty}`,
            updatedAt: new Date(),
          },
        });
    }
    if (mode === "replace") {
      // Drop rows that ended with no quantity and no reservations. Rows still
      // referenced by an order are kept at quantity 0: order_items.stock_id is
      // ON DELETE NO ACTION, so deleting them would abort the whole import
      // (every sold-out card hits this once its order is completed).
      await tx.delete(stock).where(sql`
        ${stock.quantity} = 0
        and ${stock.reserved} = 0
        and not exists (
          select 1 from ${orderItems} where ${orderItems.stockId} = ${stock.id}
        )
        and ${delverScope}
      `);
    }
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stock);
  return {
    mode,
    imported: agg.size,
    unmatched: preview.unmatched.length,
    stockRows: count,
  };
}
