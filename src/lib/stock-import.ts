/**
 * Delver Lens import workflow, on top of the parser/matcher in
 * delver-import.ts and the ledger in stock.ts:
 *
 *   upload  → createImportPreview()  stock_imports row, status 'previewed'
 *   confirm → applyImport()          exactly the stored lines, status 'applied'
 *   undo    → undoImport()           reverses the import's movements
 *
 * Replace imports additionally need REPLACE_PHRASE typed by the admin, and
 * the confirmation screen shows replaceImpact() first.
 */
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { stock, stockImports, stockMovements } from "@/db/schema";
import {
  DELVER_GAME_ID,
  aggregateMatched,
  applyImportLines,
  previewDelverImport,
  type ApplyStats,
} from "@/lib/delver-import";
import { StockError, addStockCopies, applyStockDelta } from "@/lib/stock";

export const REPLACE_PHRASE = "REEMPLAZAR TODO EL STOCK";

export type StoredLine = {
  printingId: string;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
};

export type StoredUnmatched = { name: string | null; scryfallId: string; quantity: number };

export type StoredRows = { lines: StoredLine[]; unmatched: StoredUnmatched[] };

export type ImportSummary = {
  lines: number;
  copies: number;
  unmatchedRows: number;
  unmatchedCopies: number;
  applied?: ApplyStats;
  undo?: { reversed: number; notReversed: { label: string; wanted: number; done: number }[] };
};

export type ImportRecord = Omit<typeof stockImports.$inferSelect, "rows" | "summary"> & {
  rows: StoredRows;
  summary: ImportSummary;
};

export class ImportError extends Error {}

const variantKey = (v: { printingId: string; finish: string; condition: string; language: string }) =>
  `${v.printingId}|${v.finish}|${v.condition}|${v.language}`;

export async function createImportPreview(
  text: string,
  filename: string | null,
  kind: "add" | "replace",
): Promise<string> {
  const preview = await previewDelverImport(text);
  if (!preview.rows.length) throw new ImportError("El archivo no tiene filas con Scryfall ID.");

  const details = new Map(preview.matched.map((m) => [m.printingId, m]));
  const lines: StoredLine[] = aggregateMatched(preview.matched).map((l) => {
    const d = details.get(l.printingId)!;
    return {
      ...l,
      cardName: d.cardName,
      setName: d.setName,
      setCode: d.setCode,
      collectorNumber: d.collectorNumber,
    };
  });
  lines.sort((a, b) => a.cardName.localeCompare(b.cardName) || a.setName.localeCompare(b.setName));
  const unmatched: StoredUnmatched[] = preview.unmatched.map((u) => ({
    name: u.name ?? null,
    scryfallId: u.scryfallId,
    quantity: u.quantity,
  }));
  const summary: ImportSummary = {
    lines: lines.length,
    copies: lines.reduce((n, l) => n + l.quantity, 0),
    unmatchedRows: unmatched.length,
    unmatchedCopies: unmatched.reduce((n, u) => n + u.quantity, 0),
  };
  const rows: StoredRows = { lines, unmatched };
  const [row] = await db
    .insert(stockImports)
    .values({ kind, filename, rows, summary })
    .returning({ id: stockImports.id });
  return row.id;
}

export async function getImport(id: string): Promise<ImportRecord | null> {
  const [row] = await db.select().from(stockImports).where(eq(stockImports.id, id));
  return (row as ImportRecord | undefined) ?? null;
}

export async function listImports(limit = 30) {
  const rows = await db
    .select({
      id: stockImports.id,
      kind: stockImports.kind,
      status: stockImports.status,
      filename: stockImports.filename,
      summary: stockImports.summary,
      createdAt: stockImports.createdAt,
      appliedAt: stockImports.appliedAt,
      undoneAt: stockImports.undoneAt,
    })
    .from(stockImports)
    .where(ne(stockImports.status, "discarded"))
    .orderBy(desc(stockImports.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, summary: r.summary as unknown as ImportSummary }));
}

/** Current quantity of each variant in the file (for "now → after" columns). */
export async function currentQuantities(lines: StoredLine[]): Promise<Map<string, number>> {
  if (!lines.length) return new Map();
  const printingIds = [...new Set(lines.map((l) => l.printingId))];
  const rows = await db
    .select()
    .from(stock)
    .where(sql`${stock.printingId} in ${printingIds}`);
  return new Map(rows.map((r) => [variantKey(r), r.quantity]));
}

export type ReplaceImpact = {
  currentCopies: number;
  fileCopies: number;
  /** Variants in stock now that the file omits entirely. */
  removedVariants: number;
  removedCopies: number;
  reducedVariants: number;
  increasedVariants: number;
  newVariants: number;
  /** Rows that can't drop to the file's count: web orders hold copies. */
  heldByReservations: number;
  /** Stock changes made on the site since the last applied import. */
  siteChangesSinceLastImport: number;
  lastImportAt: Date | null;
  /** Biggest losses first. */
  losses: { cardName: string; setName: string; finish: string; condition: string; language: string; now: number; after: number }[];
};

/** What a replace import would do to MTG stock right now. */
export async function replaceImpact(lines: StoredLine[]): Promise<ReplaceImpact> {
  const current = (
    await db.execute(sql`
      select s.printing_id, s.finish, s.condition, s.language, s.quantity, s.reserved,
             c.name as card_name, p.set_name
      from stock s
      join printings p on p.id = s.printing_id
      join cards c on c.id = p.card_id
      where c.game_id = ${DELVER_GAME_ID}
    `)
  ).rows as {
    printing_id: string; finish: string; condition: string; language: string;
    quantity: number; reserved: number; card_name: string; set_name: string;
  }[];
  const file = new Map(lines.map((l) => [variantKey(l), l.quantity]));
  const impact: ReplaceImpact = {
    currentCopies: 0,
    fileCopies: lines.reduce((n, l) => n + l.quantity, 0),
    removedVariants: 0,
    removedCopies: 0,
    reducedVariants: 0,
    increasedVariants: 0,
    newVariants: 0,
    heldByReservations: 0,
    siteChangesSinceLastImport: 0,
    lastImportAt: null,
    losses: [],
  };
  const seen = new Set<string>();
  for (const r of current) {
    const key = variantKey({ printingId: r.printing_id, ...r });
    seen.add(key);
    impact.currentCopies += r.quantity;
    const want = file.get(key) ?? 0;
    const after = Math.max(want, r.reserved);
    if (r.reserved > want) impact.heldByReservations++;
    if (after < r.quantity) {
      if (!file.has(key)) {
        impact.removedVariants++;
      } else impact.reducedVariants++;
      impact.removedCopies += r.quantity - after;
      impact.losses.push({
        cardName: r.card_name, setName: r.set_name, finish: r.finish,
        condition: r.condition, language: r.language, now: r.quantity, after,
      });
    } else if (after > r.quantity) impact.increasedVariants++;
  }
  for (const l of lines) if (!seen.has(variantKey(l)) && l.quantity > 0) impact.newVariants++;
  impact.losses.sort((a, b) => b.now - b.after - (a.now - a.after) || a.cardName.localeCompare(b.cardName));

  const [last] = await db
    .select({ at: stockImports.appliedAt })
    .from(stockImports)
    .where(eq(stockImports.status, "applied"))
    .orderBy(desc(stockImports.appliedAt))
    .limit(1);
  impact.lastImportAt = last?.at ?? null;
  const [{ n }] = (
    await db.execute(sql`
      select count(*)::int as n
      from stock_movements m
      join printings p on p.id = m.printing_id
      join cards c on c.id = p.card_id
      where c.game_id = ${DELVER_GAME_ID}
        and m.reason in ('manual_add', 'manual_adjust', 'web_order', 'in_store_sale')
        ${last?.at ? sql`and m.created_at > ${last.at}` : sql``}
    `)
  ).rows as { n: number }[];
  impact.siteChangesSinceLastImport = n;
  return impact;
}

export async function applyImport(id: string, typedPhrase?: string): Promise<ApplyStats> {
  return db.transaction(async (tx) => {
    const [imp] = await tx.select().from(stockImports).where(eq(stockImports.id, id)).for("update");
    if (!imp) throw new ImportError("La importación no existe.");
    if (imp.status !== "previewed") throw new ImportError("Esta importación ya fue aplicada o descartada.");
    if (imp.kind === "replace" && typedPhrase?.trim() !== REPLACE_PHRASE) {
      throw new ImportError(`Para reemplazar el stock tenés que escribir exactamente: ${REPLACE_PHRASE}`);
    }
    const rows = imp.rows as unknown as StoredRows;
    const stats = await applyImportLines(tx, rows.lines, imp.kind, id);
    const summary = { ...(imp.summary as ImportSummary), applied: stats };
    await tx
      .update(stockImports)
      .set({ status: "applied", appliedAt: new Date(), summary })
      .where(eq(stockImports.id, id));
    return stats;
  });
}

export async function discardImport(id: string): Promise<void> {
  await db
    .update(stockImports)
    .set({ status: "discarded" })
    .where(and(eq(stockImports.id, id), eq(stockImports.status, "previewed")));
}

/**
 * Only the latest applied import can be undone: undoing an older one after a
 * newer import (especially a replace) has touched the same rows would not
 * restore any meaningful state.
 */
export async function canUndo(imp: { id: string; status: string; appliedAt: Date | null }) {
  if (imp.status !== "applied" || !imp.appliedAt) return false;
  const [later] = await db
    .select({ id: stockImports.id })
    .from(stockImports)
    .where(and(eq(stockImports.status, "applied"), gt(stockImports.appliedAt, imp.appliedAt)))
    .limit(1);
  return !later;
}

/**
 * Reverses every movement the import made. Copies that were added and have
 * since been sold or reserved cannot be taken back; those lines are reversed
 * as far as possible and reported.
 */
export async function undoImport(id: string): Promise<NonNullable<ImportSummary["undo"]>> {
  const imp = await getImport(id);
  if (!imp || !(await canUndo(imp))) {
    throw new ImportError("Solo se puede deshacer la última importación aplicada.");
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(stockImports).where(eq(stockImports.id, id)).for("update");
    if (locked.status !== "applied") throw new ImportError("Esta importación ya no está aplicada.");

    const moves = await tx
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.importId, id));
    // Net effect per variant (a replace can touch a row only once, but be safe).
    const net = new Map<string, { m: (typeof moves)[number]; delta: number }>();
    for (const m of moves) {
      const k = variantKey(m);
      const cur = net.get(k);
      if (cur) cur.delta += m.delta;
      else net.set(k, { m, delta: m.delta });
    }

    const result: NonNullable<ImportSummary["undo"]> = { reversed: 0, notReversed: [] };
    const meta = { reason: "import_undo" as const, importId: id };
    const labels = new Map(
      (imp.rows.lines ?? []).map((l) => [variantKey(l), `${l.cardName} (${l.setName})`]),
    );
    for (const [k, { m, delta }] of net) {
      if (delta === 0) continue;
      const label = labels.get(k) ?? `${m.finish} ${m.condition} ${m.language.toUpperCase()}`;
      if (delta < 0) {
        // Copies the import removed: put them back (row may have been deleted).
        await addStockCopies(tx, m, -delta, meta);
        result.reversed += -delta;
        continue;
      }
      // Copies the import added: take back what is still unsold/unreserved.
      const [row] = await tx
        .select()
        .from(stock)
        .where(
          and(
            eq(stock.printingId, m.printingId),
            eq(stock.finish, m.finish),
            eq(stock.condition, m.condition),
            eq(stock.language, m.language),
          ),
        )
        .for("update");
      const free = row ? Math.max(row.quantity - row.reserved, 0) : 0;
      const take = Math.min(delta, free);
      if (take > 0) {
        try {
          await applyStockDelta(tx, row!.id, -take, meta);
        } catch (err) {
          if (!(err instanceof StockError)) throw err;
        }
        result.reversed += take;
      }
      if (take < delta) result.notReversed.push({ label, wanted: delta, done: take });
    }
    await tx
      .update(stockImports)
      .set({
        status: "undone",
        undoneAt: new Date(),
        summary: { ...imp.summary, undo: result },
      })
      .where(eq(stockImports.id, id));
    return result;
  });
}
