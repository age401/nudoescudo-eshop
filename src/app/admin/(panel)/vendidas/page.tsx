/**
 * "Sold — remove from Delver" report.
 *
 * The shop's inventory is overwritten from a Delver Lens export, so anything
 * sold here has to be pulled out of the Delver collection by hand first;
 * otherwise the next replace-import resurrects it. This lists the cards from
 * delivered orders that haven't been reconciled yet, and records the ones the
 * admin says they've removed.
 */
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import {
  delverHistory,
  pendingDelverLines,
  pendingDelverOrderIds,
} from "@/lib/delver-report";
import { M } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.delver.title} — ${M.storeName}` };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINISH_LABEL: Record<string, string> = {
  nonfoil: M.card.nonfoil,
  foil: M.card.foil,
  etched: M.card.etched,
};

/**
 * Marks exactly the orders that were on screen. Marking "everything pending"
 * instead would silently swallow orders delivered between render and click,
 * whose cards are still sitting in Delver.
 */
async function markRemovedAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const ids = formData.getAll("id").map(String).filter((id) => UUID_RE.test(id));
  if (ids.length) {
    await db
      .update(orders)
      .set({ delverRemovedAt: new Date() })
      .where(
        and(
          inArray(orders.id, ids),
          eq(orders.status, "completed"),
          isNull(orders.delverRemovedAt),
        ),
      );
  }
  revalidatePath("/admin/vendidas");
  revalidatePath("/admin");
}

async function undoRemovedAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  if (UUID_RE.test(id)) {
    await db
      .update(orders)
      .set({ delverRemovedAt: null })
      .where(eq(orders.id, id));
  }
  revalidatePath("/admin/vendidas");
  revalidatePath("/admin");
}

export default async function AdminDelverPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>;
}) {
  const { ver } = await searchParams;
  const showHistory = ver === "hechas";
  const D = M.admin.delver;

  const [pending, pendingOrderIds] = await Promise.all([
    pendingDelverLines(),
    pendingDelverOrderIds(),
  ]);
  const totalCopies = pending.reduce((n, r) => n + r.qty, 0);
  const history = showHistory ? await delverHistory() : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{D.title}</h2>
        <div className="flex gap-1 text-sm">
          <Link
            href="/admin/vendidas"
            className={`rounded-lg px-3 py-1.5 ${!showHistory ? "bg-felt text-paper" : "text-ink-soft hover:bg-paper-dim"}`}
          >
            {D.pendingTab}
            {pending.length > 0 && ` (${pending.length})`}
          </Link>
          <Link
            href="/admin/vendidas?ver=hechas"
            className={`rounded-lg px-3 py-1.5 ${showHistory ? "bg-felt text-paper" : "text-ink-soft hover:bg-paper-dim"}`}
          >
            {D.historyTab}
          </Link>
        </div>
      </div>

      {!showHistory && (
        <>
          <div className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
            <p className="text-sm text-ink-soft">{D.intro}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              {D.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          {pending.length === 0 ? (
            <p className="mt-8 text-center text-ink-soft">{D.empty}</p>
          ) : (
            <>
              <p className="mt-6 text-sm font-medium">
                {D.summary(totalCopies, pendingOrderIds.length)}
              </p>

              <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                      <th className="px-4 py-3">{D.card}</th>
                      <th className="px-4 py-3">{D.variant}</th>
                      <th className="px-4 py-3 text-right">{D.qty}</th>
                      <th className="px-4 py-3">{D.soldIn}</th>
                      <th className="px-4 py-3">{D.soldAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr
                        key={`${r.card_name}|${r.set_name}|${r.collector_number}|${r.finish}|${r.condition}|${r.language}`}
                        className="border-b border-ink/5 last:border-0"
                      >
                        <td className="px-4 py-2">
                          <p className="font-medium">{r.card_name}</p>
                          <p className="text-xs text-ink-faint">
                            {r.set_name}
                            {r.collector_number ? ` #${r.collector_number}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {FINISH_LABEL[r.finish] ?? r.finish} · {r.condition} ·{" "}
                          {r.language.toUpperCase()}
                        </td>
                        <td className="font-price px-4 py-2 text-right font-semibold">
                          {r.qty}
                        </td>
                        <td className="font-price px-4 py-2 text-xs text-ink-soft">
                          {r.codes}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-faint">
                          {r.last_sold
                            ? new Date(r.last_sold).toLocaleDateString("es-UY", {
                                dateStyle: "short",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form action={markRemovedAction} className="mt-4">
                {pendingOrderIds.map((id) => (
                  <input key={id} type="hidden" name="id" value={id} />
                ))}
                <button
                  type="submit"
                  className="rounded-lg bg-felt px-4 py-2 text-sm font-semibold text-paper hover:bg-felt-soft"
                >
                  {D.markDone}
                </button>
                <p className="mt-2 text-xs text-ink-faint">{D.markHelp}</p>
              </form>
            </>
          )}
        </>
      )}

      {showHistory &&
        (history.length === 0 ? (
          <p className="mt-8 text-center text-ink-soft">{D.emptyHistory}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                  <th className="px-4 py-3">{D.order}</th>
                  <th className="px-4 py-3 text-right">{D.qty}</th>
                  <th className="px-4 py-3">{D.date}</th>
                  <th className="px-4 py-3">{D.markedAt}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/pedidos/${h.id}`}
                        className="font-price font-semibold text-felt hover:underline"
                      >
                        {h.public_code}
                      </Link>
                    </td>
                    <td className="font-price px-4 py-2 text-right">{h.copies}</td>
                    <td className="px-4 py-2 text-xs text-ink-faint">
                      {h.closed_at
                        ? new Date(h.closed_at).toLocaleDateString("es-UY", {
                            dateStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-faint">
                      {new Date(h.delver_removed_at).toLocaleString("es-UY", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={undoRemovedAction}>
                        <input type="hidden" name="id" value={h.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium hover:border-felt"
                        >
                          {D.undo}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
