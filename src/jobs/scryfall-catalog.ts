/**
 * Imports the MTG catalog (all cards + printings) from Scryfall bulk data.
 * Streams the `default_cards` file (hundreds of MB) without loading it whole.
 *
 * Idempotent: upserts by oracle_id (cards) and scryfall id (printings).
 */
import fs from "node:fs";
import readline from "node:readline";
import { eq, sql } from "drizzle-orm";
import StreamArray from "stream-json/streamers/StreamArray";
import { db } from "@/db";
import { cards, printings } from "@/db/schema";
import { downloadToCache, fetchJson } from "@/lib/download";
import { normalizeName, slugify } from "@/lib/normalize";
import { withSyncRun } from "@/lib/sync-runs";

type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  layout: string;
  color_identity?: string[];
  cmc?: number;
  games?: string[];
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  released_at?: string;
  finishes?: string[];
  image_uris?: Record<string, string>;
  card_faces?: { image_uris?: Record<string, string>; oracle_id?: string }[];
};

const EXCLUDED_LAYOUTS = new Set([
  "token",
  "double_faced_token",
  "emblem",
  "art_series",
  "scheme",
  "planar",
  "vanguard",
]);

function pickImages(c: ScryfallCard): Record<string, string> | null {
  const uris = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  if (!uris) return null;
  const picked: Record<string, string> = {};
  for (const k of ["small", "normal", "large"]) if (uris[k]) picked[k] = uris[k];
  // Second face image for transform cards.
  const back = c.card_faces?.[1]?.image_uris?.normal;
  if (back) picked.back = back;
  return picked;
}

/** Stream card objects from a bulk file, one at a time. */
async function* readScryfallCards(file: string, jsonl: boolean): AsyncGenerator<ScryfallCard> {
  if (jsonl) {
    const lines = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ScryfallCard;
    }
    return;
  }
  const stream = fs.createReadStream(file).pipe(StreamArray.withParser());
  for await (const { value } of stream) yield value as ScryfallCard;
}

export async function syncScryfallCatalog(opts: { sets?: string[] } = {}) {
  return withSyncRun("scryfall_catalog", async () => {
    const bulk = await fetchJson<{
      data: { type: string; download_uri?: string; jsonl_download_uri?: string }[];
    }>("https://api.scryfall.com/bulk-data");
    const def = bulk.data.find((d) => d.type === "default_cards");
    if (!def) throw new Error("default_cards bulk entry not found");

    // Scryfall replaced the single JSON array (`download_uri`) with gzipped
    // JSON Lines (`jsonl_download_uri`) in 2026. Prefer the new format, keep
    // the old one as a fallback.
    const jsonl = Boolean(def.jsonl_download_uri);
    const url = def.jsonl_download_uri ?? def.download_uri;
    if (!url) throw new Error("default_cards bulk entry has no download URL");
    const file = await downloadToCache(
      url,
      jsonl ? "scryfall-default-cards.jsonl" : "scryfall-default-cards.json",
      20,
    );
    const setFilter = opts.sets?.length
      ? new Set(opts.sets.map((s) => s.toLowerCase()))
      : null;

    // oracle_id -> card row id, filled lazily as we encounter cards.
    const cardIdByOracle = new Map<string, string>();
    // oracle_id -> last-known colors / mana value, so a re-sync backfills or
    // updates them on cards that already existed without re-upserting every
    // unchanged row.
    const cardColorsByOracle = new Map<string, string[]>();
    const cardManaByOracle = new Map<string, string | null>();
    const usedSlugs = new Set<string>(
      (await db.select({ slug: cards.slug }).from(cards)).map((r) => r.slug),
    );
    const existingCards = await db
      .select({
        id: cards.id,
        ext: cards.externalGroupId,
        colors: cards.colors,
        manaValue: cards.manaValue,
      })
      .from(cards);
    for (const r of existingCards) {
      cardIdByOracle.set(r.ext, r.id);
      cardColorsByOracle.set(r.ext, r.colors);
      cardManaByOracle.set(r.ext, r.manaValue);
    }

    let scanned = 0;
    let importedPrintings = 0;
    let newCards = 0;

    type PrintingRow = typeof printings.$inferInsert;
    let printingBatch: PrintingRow[] = [];

    async function flushPrintings() {
      if (!printingBatch.length) return;
      await db
        .insert(printings)
        .values(printingBatch)
        .onConflictDoUpdate({
          target: printings.externalId,
          set: {
            setCode: sql`excluded.set_code`,
            setName: sql`excluded.set_name`,
            collectorNumber: sql`excluded.collector_number`,
            rarity: sql`excluded.rarity`,
            lang: sql`excluded.lang`,
            imageUris: sql`excluded.image_uris`,
            finishes: sql`excluded.finishes`,
            releasedAt: sql`excluded.released_at`,
          },
        });
      importedPrintings += printingBatch.length;
      printingBatch = [];
    }

    async function ensureCard(c: ScryfallCard): Promise<string | null> {
      const oracleId = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
      if (!oracleId) return null;
      const incomingColors = c.color_identity ?? [];
      // mana_value is numeric(5,2); joke cards like Gleemax (cmc 1,000,000)
      // don't fit and would abort the whole sync. They only lose sort order.
      const incomingMana =
        c.cmc != null && c.cmc < 1000 ? c.cmc.toFixed(2) : null;
      const existing = cardIdByOracle.get(oracleId);
      if (existing) {
        // Backfill / refresh colors and mana value only when they changed.
        const knownColors = cardColorsByOracle.get(oracleId);
        const knownMana = cardManaByOracle.get(oracleId);
        const colorsChanged =
          !knownColors || knownColors.join(",") !== incomingColors.join(",");
        // `knownMana === undefined` means the row predates this column.
        const manaChanged = (knownMana ?? null) !== incomingMana;
        if (colorsChanged || manaChanged) {
          await db
            .update(cards)
            .set({ colors: incomingColors, manaValue: incomingMana })
            .where(eq(cards.id, existing));
          cardColorsByOracle.set(oracleId, incomingColors);
          cardManaByOracle.set(oracleId, incomingMana);
        }
        return existing;
      }

      let slug = slugify(c.name) || oracleId;
      if (usedSlugs.has(slug)) slug = `${slug}-${oracleId.slice(0, 8)}`;
      usedSlugs.add(slug);

      const [row] = await db
        .insert(cards)
        .values({
          gameId: "mtg",
          externalGroupId: oracleId,
          name: c.name,
          normalizedName: normalizeName(c.name),
          slug,
          colors: incomingColors,
          manaValue: incomingMana,
        })
        .onConflictDoUpdate({
          target: [cards.gameId, cards.externalGroupId],
          set: {
            name: sql`excluded.name`,
            normalizedName: sql`excluded.normalized_name`,
            colors: sql`excluded.colors`,
            manaValue: sql`excluded.mana_value`,
          },
        })
        .returning({ id: cards.id });
      cardIdByOracle.set(oracleId, row.id);
      cardColorsByOracle.set(oracleId, incomingColors);
      cardManaByOracle.set(oracleId, incomingMana);
      newCards++;
      return row.id;
    }

    for await (const c of readScryfallCards(file, jsonl)) {
      scanned++;
      if (EXCLUDED_LAYOUTS.has(c.layout)) continue;
      if (!c.games?.includes("paper")) continue;
      if (setFilter && !setFilter.has(c.set.toLowerCase())) continue;

      const cardId = await ensureCard(c);
      if (!cardId) continue;

      printingBatch.push({
        cardId,
        externalId: c.id,
        setCode: c.set,
        setName: c.set_name,
        collectorNumber: c.collector_number,
        rarity: c.rarity ?? null,
        lang: c.lang,
        imageUris: pickImages(c),
        finishes: c.finishes ?? ["nonfoil"],
        releasedAt: c.released_at ?? null,
      });
      if (printingBatch.length >= 500) await flushPrintings();
    }
    await flushPrintings();

    return { scanned, importedPrintings, newCards };
  });
}
