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
import { addStockCopies, setStockQuantity, type Tx } from "@/lib/stock";

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

/**
 * Delver Lens uses 0 to mean "tracked, but I own none" (e.g. a card removed
 * from the collection but still catalogued). `parseInt("0", 10) || 1` would
 * silently coerce that real zero into 1, since 0 is falsy — this only falls
 * back to 1 when the column is absent or the cell doesn't hold a real number.
 */
function parseQuantity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed === "") return 1;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
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
      quantity: parseQuantity(kQty ? r[kQty] : undefined),
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

/** One variant to import: the file's rows for it, summed. */
export type ImportLine = {
  printingId: string;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
};

/** Sums duplicate rows of the same variant (Delver lists copies separately). */
export function aggregateMatched(matched: ImportPreview["matched"]): ImportLine[] {
  const agg = new Map<string, ImportLine>();
  for (const m of matched) {
    const finish = m.row.foil ? "foil" : "nonfoil";
    const key = `${m.printingId}|${finish}|${m.row.condition}|${m.row.language}`;
    const cur = agg.get(key);
    if (cur) cur.quantity += m.row.quantity;
    else
      agg.set(key, {
        printingId: m.printingId,
        finish,
        condition: m.row.condition,
        language: m.row.language,
        quantity: m.row.quantity,
      });
  }
  // A 0-quantity row adds nothing, but in replace mode it still means "none".
  return [...agg.values()];
}

export type ApplyStats = {
  /** Variants in the file. */
  lines: number;
  copiesAdded: number;
  copiesRemoved: number;
  /** Replace only: rows kept above the file's count because web orders hold them. */
  keptForReservations: number;
};

/**
 * Writes matched lines to stock through the ledger (src/lib/stock.ts).
 *
 * add     : adds each line's copies.
 * replace : MTG stock becomes exactly the file. Rows the file omits drop to 0
 *           — or to their reserved count, since those copies are promised to
 *           web orders — and empty, never-sold rows are deleted.
 */
export async function applyImportLines(
  tx: Tx,
  lines: ImportLine[],
  mode: "add" | "replace",
  importId: string | null,
): Promise<ApplyStats> {
  const stats: ApplyStats = {
    lines: lines.length,
    copiesAdded: 0,
    copiesRemoved: 0,
    keptForReservations: 0,
  };
  const reason = mode === "replace" ? "import_replace" : "import_add";
  const meta = { reason, importId } as const;

  if (mode === "add") {
    for (const l of lines) {
      if (l.quantity <= 0) continue;
      await addStockCopies(tx, l, l.quantity, meta);
      stats.copiesAdded += l.quantity;
    }
    return stats;
  }

  const wanted = new Map(
    lines.map((l) => [`${l.printingId}|${l.finish}|${l.condition}|${l.language}`, l]),
  );
  const existing = await tx
    .select()
    .from(stock)
    .where(delverScope)
    .for("update");
  for (const row of existing) {
    const key = `${row.printingId}|${row.finish}|${row.condition}|${row.language}`;
    const target = wanted.get(key)?.quantity ?? 0;
    wanted.delete(key);
    const { delta, quantityAfter } = await setStockQuantity(tx, row.id, target, null, meta, {
      clampToReserved: true,
    });
    if (quantityAfter > target) stats.keptForReservations++;
    if (delta > 0) stats.copiesAdded += delta;
    else stats.copiesRemoved -= delta;
  }
  for (const l of wanted.values()) {
    if (l.quantity <= 0) continue;
    await addStockCopies(tx, l, l.quantity, meta);
    stats.copiesAdded += l.quantity;
  }
  // Drop rows that ended empty. Rows referenced by an order are kept at 0:
  // order_items.stock_id has no cascade.
  await tx.delete(stock).where(sql`
    ${stock.quantity} = 0
    and ${stock.reserved} = 0
    and not exists (
      select 1 from ${orderItems} where ${orderItems.stockId} = ${stock.id}
    )
    and ${delverScope}
  `);
  return stats;
}

/** Parse, match and apply in one go (CLI and tests). */
export async function applyDelverImport(
  text: string,
  mode: "merge" | "replace",
): Promise<ImportResult> {
  const preview = await previewDelverImport(text);
  const lines = aggregateMatched(preview.matched);
  await db.transaction((tx) =>
    applyImportLines(tx, lines, mode === "replace" ? "replace" : "add", null),
  );
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stock);
  return {
    mode,
    imported: lines.length,
    unmatched: preview.unmatched.length,
    stockRows: count,
  };
}
