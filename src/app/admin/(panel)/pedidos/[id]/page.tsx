import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, orderItems, orders, printings, stock } from "@/db/schema";
import { AdminOrderItems } from "@/components/AdminOrderItems";
import { requireAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";
import { cancelOrder, completeOrder } from "@/lib/orders";
import { formatUsd } from "@/lib/pricing";

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

  // Colors and mana value live on the card, not on the order snapshot, so
  // they are joined in for sorting. Left joins keep items readable even if a
  // stock row or printing was pruned after the sale.
  const rows = await db
    .select({
      item: orderItems,
      colors: cards.colors,
      manaValue: cards.manaValue,
    })
    .from(orderItems)
    .leftJoin(stock, eq(stock.id, orderItems.stockId))
    .leftJoin(printings, eq(printings.id, stock.printingId))
    .leftJoin(cards, eq(cards.id, printings.cardId))
    .where(eq(orderItems.orderId, id));

  const items = rows.map((r) => ({
    id: r.item.id,
    cardName: r.item.cardName,
    setName: r.item.setName,
    collectorNumber: r.item.collectorNumber,
    finish: r.item.finish,
    condition: r.item.condition,
    language: r.item.language,
    quantity: r.item.quantity,
    unitPriceUsd: Number(r.item.unitPriceUsd),
    imageUrl: r.item.imageUrl,
    colors: r.colors ?? [],
    manaValue: r.manaValue != null ? Number(r.manaValue) : null,
  }));
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
        <div>
          <AdminOrderItems items={items} />
          <p className="mt-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-right">
            <span className="font-price text-lg font-semibold text-felt">
              {formatUsd(Number(order.totalUsd))}
            </span>
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
