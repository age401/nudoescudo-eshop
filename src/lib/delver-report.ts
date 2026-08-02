/**
 * "Sold — remove from Delver" report.
 *
 * Inventory is overwritten from a Delver Lens export, so a card sold here has
 * to be pulled out of the Delver collection by hand before the next
 * replace-import, or it comes straight back into stock.
 *
 * Only cards Delver actually tracks are reported: Pokemon stock is entered by
 * hand and never appears in a Delver file, so it needs no reconciliation.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DELVER_GAME_ID } from "@/lib/delver-import";

export type PendingLine = {
  card_name: string;
  set_name: string;
  collector_number: string | null;
  finish: string;
  condition: string;
  language: string;
  qty: number;
  codes: string;
  last_sold: string | null;
};

export type HistoryRow = {
  id: string;
  public_code: string;
  closed_at: string | null;
  delver_removed_at: string;
  copies: number;
};

/** Delivered, not yet reconciled, and tracked by Delver. */
const pendingItems = sql`
  from order_items oi
  join orders o on o.id = oi.order_id
  join stock s on s.id = oi.stock_id
  join printings p on p.id = s.printing_id
  join cards c on c.id = p.card_id
  where o.status = 'completed'
    and o.delver_removed_at is null
    and c.game_id = ${DELVER_GAME_ID}
`;

/**
 * One row per distinct card variant, which is what the admin searches for in
 * Delver. Grouped on the order_items display snapshot so the report still
 * reads correctly if the catalog changes underneath it.
 */
export async function pendingDelverLines(): Promise<PendingLine[]> {
  return (
    await db.execute(sql`
      select oi.card_name, oi.set_name, oi.collector_number,
             oi.finish, oi.condition, oi.language,
             sum(oi.quantity)::int as qty,
             string_agg(distinct o.public_code, ', ') as codes,
             max(o.closed_at) as last_sold
      ${pendingItems}
      group by 1, 2, 3, 4, 5, 6
      order by oi.card_name, oi.set_name, oi.collector_number
    `)
  ).rows as PendingLine[];
}

/** Order ids behind the pending lines, used to record the reconciliation. */
export async function pendingDelverOrderIds(): Promise<string[]> {
  const rows = (
    await db.execute(sql`select distinct o.id ${pendingItems}`)
  ).rows as { id: string }[];
  return rows.map((r) => r.id);
}

/** Total copies still to pull from Delver; drives the dashboard and warnings. */
export async function pendingDelverCopies(): Promise<number> {
  const [row] = (
    await db.execute(sql`
      select coalesce(sum(oi.quantity), 0)::int as copies ${pendingItems}
    `)
  ).rows as { copies: number }[];
  return row?.copies ?? 0;
}

export async function delverHistory(limit = 50): Promise<HistoryRow[]> {
  return (
    await db.execute(sql`
      select o.id, o.public_code, o.closed_at, o.delver_removed_at,
             coalesce(sum(oi.quantity), 0)::int as copies
      from orders o
      left join order_items oi on oi.order_id = o.id
      where o.delver_removed_at is not null
      group by o.id, o.public_code, o.closed_at, o.delver_removed_at
      order by o.delver_removed_at desc
      limit ${limit}
    `)
  ).rows as HistoryRow[];
}
