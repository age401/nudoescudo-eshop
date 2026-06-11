import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { M } from "@/lib/messages";
import { formatUsd } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.orders.title} — ${M.storeName}` };

const STATUS_STYLE: Record<string, string> = {
  pending_confirmation: "bg-foil-soft text-ink",
  confirmed: "bg-felt/10 text-felt",
  completed: "bg-ink/5 text-ink-soft",
  cancelled: "bg-danger/10 text-danger",
  expired: "bg-ink/5 text-ink-faint",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const { filtro } = await searchParams;
  const showAll = filtro === "todos";

  const rows = await db
    .select()
    .from(orders)
    .where(
      showAll
        ? undefined
        : inArray(orders.status, ["pending_confirmation", "confirmed"]),
    )
    .orderBy(desc(orders.createdAt))
    .limit(200);

  const O = M.admin.orders;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{O.title}</h2>
        <div className="flex gap-1 text-sm">
          <Link
            href="/admin/pedidos"
            className={`rounded-lg px-3 py-1.5 ${!showAll ? "bg-felt text-paper" : "text-ink-soft hover:bg-paper-dim"}`}
          >
            {O.filterActive}
          </Link>
          <Link
            href="/admin/pedidos?filtro=todos"
            className={`rounded-lg px-3 py-1.5 ${showAll ? "bg-felt text-paper" : "text-ink-soft hover:bg-paper-dim"}`}
          >
            {O.filterAll}
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-ink-soft">{O.empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="px-4 py-3">{O.code}</th>
                <th className="px-4 py-3">{O.customer}</th>
                <th className="px-4 py-3">{O.date}</th>
                <th className="px-4 py-3 text-right">{O.total}</th>
                <th className="px-4 py-3">{O.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-ink/5 last:border-0 hover:bg-paper-dim/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/pedidos/${o.id}`} className="font-price font-semibold text-felt hover:underline">
                      {o.publicCode}
                    </Link>
                    {o.status === "confirmed" && !o.seenByAdmin && (
                      <span className="ml-2 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white">
                        {O.new}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {o.customerName ? `${o.customerName} · ` : ""}
                    <span className="text-ink-soft">{o.email}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-faint">
                    {o.createdAt.toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="font-price px-4 py-3 text-right font-semibold">
                    {formatUsd(Number(o.totalUsd))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[o.status]}`}>
                      {M.orderStatus.statusNames[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
