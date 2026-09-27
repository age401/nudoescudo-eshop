import Link from "next/link";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { M } from "@/lib/messages";
import { normalizeName } from "@/lib/normalize";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.movements.title} — ${M.storeName}` };

const PAGE_SIZE = 100;
const V = M.admin.movements;
const FINISH_LABEL: Record<string, string> = {
  nonfoil: M.card.nonfoil,
  foil: M.card.foil,
  etched: M.card.etched,
  reverse: M.card.reverse,
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = {
  id: string;
  created_at: string;
  delta: number;
  quantity_after: number;
  reason: string;
  note: string | null;
  finish: string;
  condition: string;
  language: string;
  card_name: string;
  set_name: string;
  collector_number: string;
  order_id: string | null;
  order_code: string | null;
  import_id: string | null;
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; motivo?: string; desde?: string; hasta?: string; pag?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const reason = sp.motivo && sp.motivo in V.reasons ? sp.motivo : "";
  const from = sp.desde && DATE_RE.test(sp.desde) ? sp.desde : "";
  const to = sp.hasta && DATE_RE.test(sp.hasta) ? sp.hasta : "";
  const page = Math.max(parseInt(sp.pag ?? "", 10) || 1, 1);

  const conds: SQL[] = [sql`true`];
  if (q) conds.push(sql`c.normalized_name like ${`%${normalizeName(q)}%`}`);
  if (reason) conds.push(sql`m.reason = ${reason}`);
  // Dates are the shop's local days.
  if (from) conds.push(sql`m.created_at >= (${from}::date)::timestamp at time zone 'America/Montevideo'`);
  if (to) conds.push(sql`m.created_at < ((${to}::date + 1)::timestamp at time zone 'America/Montevideo')`);
  const where = sql.join(conds, sql` and `);

  const rows = (
    await db.execute(sql`
      select m.id, m.created_at, m.delta, m.quantity_after, m.reason, m.note,
             m.finish, m.condition, m.language,
             c.name as card_name, p.set_name, p.collector_number,
             m.order_id, o.public_code as order_code, m.import_id
      from stock_movements m
      join printings p on p.id = m.printing_id
      join cards c on c.id = p.card_id
      left join orders o on o.id = m.order_id
      where ${where}
      order by m.created_at desc, m.id
      limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}
    `)
  ).rows as Row[];
  const hasNext = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);

  const params = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (reason) u.set("motivo", reason);
    if (from) u.set("desde", from);
    if (to) u.set("hasta", to);
    if (p > 1) u.set("pag", String(p));
    return `/admin/stock/movimientos?${u}`;
  };

  return (
    <div>
      <p className="text-sm text-ink-soft">{V.intro}</p>

      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 bg-white p-4 text-xs">
        <label className="block">
          <span className="font-medium">{V.card}</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={M.admin.stock.search}
            className="mt-1 block w-56 rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="font-medium">{V.reason}</span>
          <select
            name="motivo"
            defaultValue={reason}
            className="mt-1 block rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">{V.allReasons}</option>
            {Object.entries(V.reasons).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">{V.from}</span>
          <input type="date" name="desde" defaultValue={from} className="mt-1 block rounded-lg border border-ink/15 px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium">{V.to}</span>
          <input type="date" name="hasta" defaultValue={to} className="mt-1 block rounded-lg border border-ink/15 px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-felt px-4 py-1.5 text-sm font-semibold text-paper hover:bg-felt-soft">
          {M.admin.stock.filters.apply}
        </button>
      </form>

      {shown.length === 0 ? (
        <p className="mt-8 text-center text-ink-soft">{V.empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="px-3 py-3">{V.date}</th>
                <th className="px-3 py-3">{V.card}</th>
                <th className="px-3 py-3">{V.variant}</th>
                <th className="px-3 py-3 text-right">{V.change}</th>
                <th className="px-3 py-3 text-right">{V.after}</th>
                <th className="px-3 py-3">{V.reason}</th>
                <th className="px-3 py-3">{V.ref}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-ink-faint">
                    {new Date(r.created_at).toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.card_name}</p>
                    <p className="text-xs text-ink-faint">
                      {r.set_name} #{r.collector_number}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {FINISH_LABEL[r.finish] ?? r.finish} · {r.condition} · {r.language.toUpperCase()}
                  </td>
                  <td className={`font-price px-3 py-2 text-right font-semibold ${r.delta > 0 ? "text-felt" : "text-danger"}`}>
                    {r.delta > 0 ? "+" : ""}
                    {r.delta}
                  </td>
                  <td className="font-price px-3 py-2 text-right text-ink-soft">{r.quantity_after}</td>
                  <td className="px-3 py-2 text-xs">{V.reasons[r.reason] ?? r.reason}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.order_id && (
                      <Link href={`/admin/pedidos/${r.order_id}`} className="font-price font-semibold text-felt hover:underline">
                        {r.order_code}
                      </Link>
                    )}
                    {r.import_id && (
                      <Link href={`/admin/stock/importar/${r.import_id}`} className="text-felt hover:underline">
                        importación
                      </Link>
                    )}
                    {r.note && <span className="ml-1 italic text-ink-soft">“{r.note}”</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasNext) && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={params(page - 1)} className="rounded-lg border border-ink/15 px-3 py-1.5 hover:border-felt">
              {M.catalog.prev}
            </Link>
          )}
          {hasNext && (
            <Link href={params(page + 1)} className="rounded-lg border border-ink/15 px-3 py-1.5 hover:border-felt">
              {M.catalog.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
