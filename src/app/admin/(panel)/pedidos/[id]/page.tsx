import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";
import { cancelOrder, completeOrder } from "@/lib/orders";
import { formatUsd, formatUyu } from "@/lib/pricing";

export const dynamic = "force-dynamic";

async function completeAction(formData: FormData) {
  "use server";
  await requireAdmin();
  await completeOrder(String(formData.get("id")));
  revalidatePath("/admin/pedidos");
  redirect("/admin/pedidos");
}

async function cancelAction(formData: FormData) {
  "use server";
  await requireAdmin();
  await cancelOrder(String(formData.get("id")));
  revalidatePath("/admin/pedidos");
  redirect("/admin/pedidos");
}

async function saveNoteAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await db
    .update(orders)
    .set({ adminNote: String(formData.get("note") ?? "") })
    .where(eq(orders.id, id));
  revalidatePath(`/admin/pedidos/${id}`);
}

export default async function AdminOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) notFound();

  // Opening the detail marks it as seen (clears the NEW badge).
  if (!order.seenByAdmin) {
    await db.update(orders).set({ seenByAdmin: true }).where(eq(orders.id, id));
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const O = M.admin.orders;
  const active = order.status === "pending_confirmation" || order.status === "confirmed";

  return (
    <div>
      <Link href="/admin/pedidos" className="text-sm text-ink-faint hover:text-ink">
        ← {O.title}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">
          <span className="font-price">{order.publicCode}</span>
          <span className="ml-3 align-middle rounded-full bg-paper-dim px-3 py-1 text-sm font-medium">
            {M.orderStatus.statusNames[order.status]}
          </span>
        </h2>
        {active && (
          <div className="flex gap-2">
            {order.status === "confirmed" && (
              <form action={completeAction}>
                <input type="hidden" name="id" value={order.id} />
                <button
                  type="submit"
                  className="rounded-lg bg-felt px-4 py-2 text-sm font-semibold text-paper hover:bg-felt-soft"
                >
                  {O.complete}
                </button>
              </form>
            )}
            <form action={cancelAction}>
              <input type="hidden" name="id" value={order.id} />
              <button
                type="submit"
                className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10"
              >
                {O.cancel}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-ink/10 bg-white">
          <p className="border-b border-ink/10 px-4 py-3 text-sm font-semibold">
            {O.items}
          </p>
          <ul className="divide-y divide-ink/5">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                {i.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" className="w-10 rounded shadow-card" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.cardName}</p>
                  <p className="text-xs text-ink-faint">
                    {i.setName} · {i.finish === "nonfoil" ? "Normal" : i.finish} · {i.condition} · {i.language.toUpperCase()}
                  </p>
                </div>
                <span className="font-price text-sm">× {i.quantity}</span>
                <span className="font-price w-24 text-right text-sm font-semibold">
                  {formatUsd(Number(i.unitPriceUsd) * i.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink/10 px-4 py-3 text-right">
            <span className="font-price text-lg font-semibold text-felt">
              {formatUsd(Number(order.totalUsd))}
            </span>
            {order.totalUyu && (
              <span className="font-price ml-2 text-sm text-ink-faint">
                ≈ {formatUyu(Number(order.totalUyu))}
              </span>
            )}
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-ink/10 bg-white p-4 text-sm">
            <p className="font-semibold">{O.contact}</p>
            <p className="mt-2">
              <a href={`mailto:${order.email}`} className="text-felt hover:underline">
                {order.email}
              </a>
            </p>
            {order.customerName && <p className="mt-1">{order.customerName}</p>}
            {order.phone && <p className="mt-1">{order.phone}</p>}
            <p className="mt-3 text-xs text-ink-faint">
              {order.createdAt.toLocaleString("es-UY")}
              {order.confirmedAt &&
                ` · Confirmado: ${order.confirmedAt.toLocaleString("es-UY")}`}
            </p>
          </div>

          <form action={saveNoteAction} className="rounded-xl border border-ink/10 bg-white p-4">
            <input type="hidden" name="id" value={order.id} />
            <label className="block text-sm">
              <span className="font-semibold">{O.notes}</span>
              <textarea
                name="note"
                rows={3}
                defaultValue={order.adminNote ?? ""}
                className="mt-2 w-full rounded-lg border border-ink/15 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="mt-2 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium hover:border-felt"
            >
              {O.saveNote}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
