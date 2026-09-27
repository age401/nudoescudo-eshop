/**
 * In-store ("counter") sales from a Delver Lens scan.
 *
 * buildSaleDraft() turns the scan into a reviewable draft:
 *  - lines:    stock rows the scan matched exactly (same printing + finish),
 *              allocated best-fitting first (same language, same condition,
 *              then best condition);
 *  - problems: scanned copies that could not be covered, with suggestions —
 *              in-stock copies of the same card in other printings/finishes.
 *              Delver sometimes reads the wrong edition (an Unlimited Serra
 *              Angel that is really the 4th Edition one we stock), so these
 *              are the likely right answer, but the admin has to pick.
 *
 * confirmSale() re-validates everything under row locks and records the sale
 * as a completed 'in_store' order, taking the copies out through the ledger.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, stock } from "@/db/schema";
import { compareCondition } from "@/lib/conditions";
import { parseDelverCsv, type DelverRow } from "@/lib/delver-import";
import { normalizeName } from "@/lib/normalize";
import { computeUnitPriceUsd, round2, usdToUyu } from "@/lib/pricing";
import { getPricingContext } from "@/lib/settings";
import { applyStockDelta, StockError } from "@/lib/stock";
import { orderCode } from "@/lib/tokens";

export type Candidate = {
  stockId: string;
  printingId: string;
  cardId: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  language: string;
  available: number;
  reserved: number;
  unitPriceUsd: number | null;
  imageSmall: string | null;
};

export type DraftLine = {
  /** Stable client-side id. */
  id: string;
  candidate: Candidate;
  quantity: number;
  unitPriceUsd: number;
  source: "match" | "suggestion" | "manual";
};

export type DraftProblem = {
  id: string;
  scanned: { name: string | null; scryfallId: string; foil: boolean; condition: string; language: string };
  /** What Delver says it read, when that printing is in our catalog. */
  readAs: { cardName: string; setName: string; setCode: string; collectorNumber: string } | null;
  scannedQty: number;
  missing: number;
  reason: "no_stock" | "short" | "reserved" | "unknown_printing";
  /** Web orders holding the exact copies (reason 'reserved'). */
  reservedBy: { orderId: string; code: string; quantity: number }[];
  suggestions: Candidate[];
};

export type SaleDraft = {
  lines: DraftLine[];
  problems: DraftProblem[];
  scannedRows: number;
  scannedCopies: number;
};

type CandidateRow = {
  stock_id: string; printing_id: string; card_id: string; card_name: string;
  set_name: string; set_code: string; collector_number: string;
  finish: string; condition: string; language: string;
  quantity: number; reserved: number;
  price_override_usd: string | null; reference_usd: string | null; image_small: string | null;
};

/** In-stock copies (quantity > 0) matching a filter, with sale prices. */
export async function stockCandidates(filter: ReturnType<typeof sql>): Promise<Candidate[]> {
  const { multiplier, minimumUsd } = await getPricingContext();
  const rows = (
    await db.execute(sql`
      select s.id as stock_id, s.printing_id, c.id as card_id, c.name as card_name,
             p.set_name, p.set_code, p.collector_number,
             s.finish, s.condition, s.language, s.quantity, s.reserved,
             s.price_override_usd, pr.price_usd as reference_usd,
             p.image_uris->>'small' as image_small
      from stock s
      join printings p on p.id = s.printing_id
      join cards c on c.id = p.card_id
      left join prices pr on pr.printing_id = s.printing_id and pr.finish = s.finish
      where s.quantity > 0 and (${filter})
      order by c.name, p.released_at desc nulls last, s.finish, s.condition
    `)
  ).rows as CandidateRow[];
  return rows.map((r) => ({
    stockId: r.stock_id,
    printingId: r.printing_id,
    cardId: r.card_id,
    cardName: r.card_name,
    setName: r.set_name,
    setCode: r.set_code,
    collectorNumber: r.collector_number,
    finish: r.finish,
    condition: r.condition,
    language: r.language,
    available: Math.max(r.quantity - r.reserved, 0),
    reserved: r.reserved,
    unitPriceUsd: computeUnitPriceUsd({
      referenceUsd: r.reference_usd != null ? Number(r.reference_usd) : null,
      overrideUsd: r.price_override_usd != null ? Number(r.price_override_usd) : null,
      multiplier,
      minimumUsd,
    }),
    imageSmall: r.image_small,
  }));
}

/** Manual add: in-stock copies whose name matches. */
export async function searchSaleCandidates(q: string): Promise<Candidate[]> {
  const n = normalizeName(q);
  if (n.length < 2) return [];
  const found = await stockCandidates(sql`c.normalized_name like ${`%${n}%`}`);
  return found.filter((c) => c.available > 0).slice(0, 40);
}

const finishMatches = (foil: boolean, finish: string) =>
  foil ? finish === "foil" || finish === "etched" : finish === "nonfoil";

/** Group identical scanned copies: Delver often lists one row per copy. */
function groupScan(rows: DelverRow[]) {
  const groups = new Map<string, DelverRow>();
  for (const r of rows) {
    if (r.quantity <= 0) continue;
    const k = `${r.scryfallId}|${r.foil}|${r.condition}|${r.language}`;
    const g = groups.get(k);
    if (g) g.quantity += r.quantity;
    else groups.set(k, { ...r });
  }
  return [...groups.values()];
}

export async function buildSaleDraft(text: string): Promise<SaleDraft> {
  const scan = groupScan(parseDelverCsv(text));
  const draft: SaleDraft = {
    lines: [],
    problems: [],
    scannedRows: scan.length,
    scannedCopies: scan.reduce((n, r) => n + r.quantity, 0),
  };
  if (!scan.length) return draft;

  // Which printing (and card) did Delver read for each row?
  const ids = [...new Set(scan.map((r) => r.scryfallId))];
  const printed = (
    await db.execute(sql`
      select p.id, p.external_id, p.card_id, c.name as card_name,
             p.set_name, p.set_code, p.collector_number
      from printings p join cards c on c.id = p.card_id
      where p.external_id in ${ids}
    `)
  ).rows as { id: string; external_id: string; card_id: string; card_name: string; set_name: string; set_code: string; collector_number: string }[];
  const byExternal = new Map(printed.map((p) => [p.external_id, p]));

  // Every in-stock copy of every card involved, found by card id or — when
  // the scanned printing isn't in our catalog at all — by name.
  const cardIds = [...new Set(printed.map((p) => p.card_id))];
  const names = [
    ...new Set(
      scan.filter((r) => !byExternal.has(r.scryfallId) && r.name).map((r) => normalizeName(r.name!)),
    ),
  ];
  const conds = [sql`false`];
  if (cardIds.length) conds.push(sql`c.id in ${cardIds}`);
  if (names.length) conds.push(sql`c.normalized_name in ${names}`);
  const candidates = await stockCandidates(sql.join(conds, sql` or `));

  // Web reservations on those rows, to explain "it's here but promised".
  const reservedRows = candidates.filter((c) => c.reserved > 0).map((c) => c.stockId);
  const holders = reservedRows.length
    ? ((
        await db.execute(sql`
          select oi.stock_id, o.id as order_id, o.public_code, sum(oi.quantity)::int as quantity
          from order_items oi join orders o on o.id = oi.order_id
          where oi.stock_id in ${reservedRows}
            and o.status in ('pending_confirmation', 'confirmed')
          group by 1, 2, 3
        `)
      ).rows as { stock_id: string; order_id: string; public_code: string; quantity: number }[])
    : [];

  // Copies already allocated to earlier lines of this same draft.
  const used = new Map<string, number>();
  const free = (c: Candidate) => c.available - (used.get(c.stockId) ?? 0);
  let seq = 0;

  for (const row of scan) {
    const hit = byExternal.get(row.scryfallId);
    const exact = hit
      ? candidates
          .filter((c) => c.printingId === hit.id && finishMatches(row.foil, c.finish))
          .sort(
            (a, b) =>
              Number(b.language === row.language) - Number(a.language === row.language) ||
              Number(b.condition === row.condition) - Number(a.condition === row.condition) ||
              compareCondition(a.condition, b.condition),
          )
      : [];

    let remaining = row.quantity;
    for (const c of exact) {
      const take = Math.min(remaining, free(c));
      if (take <= 0) continue;
      used.set(c.stockId, (used.get(c.stockId) ?? 0) + take);
      draft.lines.push({
        id: `l${seq++}`,
        candidate: c,
        quantity: take,
        unitPriceUsd: c.unitPriceUsd ?? 0,
        source: "match",
      });
      remaining -= take;
      if (remaining === 0) break;
    }
    if (remaining === 0) continue;

    const exactIds = new Set(exact.map((c) => c.stockId));
    const sameCard = (c: Candidate) =>
      hit ? c.cardId === hit.card_id : row.name != null && normalizeName(c.cardName) === normalizeName(row.name);
    const suggestions = candidates
      .filter((c) => !exactIds.has(c.stockId) && sameCard(c) && c.available > 0)
      .sort(
        (a, b) =>
          Number(finishMatches(row.foil, b.finish)) - Number(finishMatches(row.foil, a.finish)) ||
          Number(b.language === row.language) - Number(a.language === row.language) ||
          compareCondition(a.condition, b.condition) ||
          b.available - a.available,
      );

    const heldBy = holders.filter((h) => exactIds.has(h.stock_id));
    const coveredSome = remaining < row.quantity;
    draft.problems.push({
      id: `p${seq++}`,
      scanned: {
        name: row.name ?? null,
        scryfallId: row.scryfallId,
        foil: row.foil,
        condition: row.condition,
        language: row.language,
      },
      readAs: hit
        ? { cardName: hit.card_name, setName: hit.set_name, setCode: hit.set_code, collectorNumber: hit.collector_number }
        : null,
      scannedQty: row.quantity,
      missing: remaining,
      reason: !hit
        ? "unknown_printing"
        : heldBy.length && exact.some((c) => c.reserved > 0 && free(c) <= 0)
          ? "reserved"
          : coveredSome
            ? "short"
            : "no_stock",
      reservedBy: heldBy.map((h) => ({ orderId: h.order_id, code: h.public_code, quantity: h.quantity })),
      suggestions,
    });
  }
  return draft;
}

// ---------------------------------------------------------------------------

export type SaleInputLine = { stockId: string; quantity: number; unitPriceUsd: number };

export type ConfirmSaleResult =
  | { ok: true; orderId: string; publicCode: string }
  | { ok: false; problems: { stockId: string; label: string; wanted: number; available: number }[]; message: string };

/**
 * Records the sale. `requestId` is a client-generated id stored as the
 * order's confirmation_token (unused for in-store orders, and unique), so a
 * double-submitted confirmation returns the first sale instead of a second.
 */
export async function confirmSale(args: {
  requestId: string;
  lines: SaleInputLine[];
  customerName?: string;
  phone?: string;
  note?: string;
}): Promise<ConfirmSaleResult> {
  const existing = await db.query.orders.findFirst({
    where: eq(orders.confirmationToken, `in_store:${args.requestId}`),
  });
  if (existing) return { ok: true, orderId: existing.id, publicCode: existing.publicCode };

  const merged = new Map<string, SaleInputLine>();
  for (const l of args.lines) {
    if (!(l.quantity > 0) || !(l.unitPriceUsd >= 0)) continue;
    const cur = merged.get(`${l.stockId}|${l.unitPriceUsd}`);
    if (cur) cur.quantity += l.quantity;
    else merged.set(`${l.stockId}|${l.unitPriceUsd}`, { ...l });
  }
  const lines = [...merged.values()];
  if (!lines.length) return { ok: false, problems: [], message: "La venta no tiene cartas." };

  const { multiplier, fxRate } = await getPricingContext();

  return db.transaction(async (tx) => {
    const stockIds = [...new Set(lines.map((l) => l.stockId))];
    const rows = (
      await tx.execute(sql`
        select s.id, s.quantity, s.reserved, s.finish, s.condition, s.language,
               c.name as card_name, p.set_name, p.collector_number,
               p.image_uris->>'small' as image_small, p.image_uris->>'normal' as image_normal
        from stock s
        join printings p on p.id = s.printing_id
        join cards c on c.id = p.card_id
        where s.id in ${stockIds}
        for update of s
      `)
    ).rows as {
      id: string; quantity: number; reserved: number; finish: string; condition: string; language: string;
      card_name: string; set_name: string; collector_number: string; image_small: string | null; image_normal: string | null;
    }[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const wanted = new Map<string, number>();
    for (const l of lines) wanted.set(l.stockId, (wanted.get(l.stockId) ?? 0) + l.quantity);
    const problems: Extract<ConfirmSaleResult, { ok: false }>["problems"] = [];
    for (const [id, qty] of wanted) {
      const r = byId.get(id);
      const available = r ? r.quantity - r.reserved : 0;
      if (available < qty) {
        problems.push({
          stockId: id,
          label: r ? `${r.card_name} (${r.set_name})` : "Carta eliminada del stock",
          wanted: qty,
          available: Math.max(available, 0),
        });
      }
    }
    if (problems.length) {
      return {
        ok: false as const,
        problems,
        message: "El stock cambió desde que armaste la venta. Revisá las cartas marcadas.",
      };
    }

    const totalUsd = round2(lines.reduce((n, l) => n + l.quantity * l.unitPriceUsd, 0));
    const now = new Date();
    const [order] = await tx
      .insert(orders)
      .values({
        publicCode: orderCode(),
        channel: "in_store",
        status: "completed",
        email: null,
        customerName: args.customerName?.trim() || null,
        phone: args.phone?.trim() || null,
        confirmationToken: `in_store:${args.requestId}`,
        fxRateUyuPerUsd: fxRate != null ? fxRate.toFixed(4) : null,
        priceMultiplier: multiplier.toFixed(3),
        totalUsd: totalUsd.toFixed(2),
        totalUyu: fxRate != null ? usdToUyu(totalUsd, fxRate).toFixed(2) : null,
        adminNote: args.note?.trim() || null,
        seenByAdmin: true,
        confirmedAt: now,
        closedAt: now,
      })
      .returning();

    for (const l of lines) {
      const r = byId.get(l.stockId)!;
      await tx.insert(orderItems).values({
        orderId: order.id,
        stockId: l.stockId,
        quantity: l.quantity,
        unitPriceUsd: l.unitPriceUsd.toFixed(2),
        cardName: r.card_name,
        setName: r.set_name,
        collectorNumber: r.collector_number,
        finish: r.finish,
        condition: r.condition,
        language: r.language,
        imageUrl: r.image_small ?? r.image_normal,
      });
      await applyStockDelta(tx, l.stockId, -l.quantity, { reason: "in_store_sale", orderId: order.id });
    }
    return { ok: true as const, orderId: order.id, publicCode: order.publicCode };
  });
}

/**
 * Annuls a completed sale (either channel): the copies go back on the shelf
 * and the order is marked cancelled. Idempotent.
 */
export async function voidCompletedOrder(orderId: string, note?: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.status !== "completed") return false;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const live = items.length
      ? await tx.select({ id: stock.id }).from(stock).where(inArray(stock.id, items.map((i) => i.stockId)))
      : [];
    const exists = new Set(live.map((s) => s.id));
    for (const item of items) {
      if (!exists.has(item.stockId)) continue; // row deleted since; nothing to return to
      try {
        await applyStockDelta(tx, item.stockId, item.quantity, { reason: "order_void", orderId, note });
      } catch (err) {
        if (!(err instanceof StockError)) throw err;
      }
    }
    await tx
      .update(orders)
      .set({
        status: "cancelled",
        closedAt: new Date(),
        adminNote: [order.adminNote, note ? `Anulada: ${note}` : "Anulada"].filter(Boolean).join("\n"),
      })
      .where(eq(orders.id, orderId));
    return true;
  });
}
