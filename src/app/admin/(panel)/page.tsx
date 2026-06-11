import Link from "next/link";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";
import { getPricingContext } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.nav.dashboard} — ${M.storeName}` };

const RUNNABLE_JOBS = [
  "scryfall_catalog",
  "mtgjson_prices",
  "fx_rate",
] as const;

async function runJob(formData: FormData) {
  "use server";
  await requireAdmin();
  const job = String(formData.get("job"));
  // Fire and forget: progress is visible via sync_runs on this dashboard.
  if (job === "scryfall_catalog") {
    void import("@/jobs/scryfall-catalog").then(({ syncScryfallCatalog }) =>
      syncScryfallCatalog().catch((e) => console.error(e)),
    );
  } else if (job === "mtgjson_prices") {
    void import("@/jobs/mtgjson-prices").then(({ syncCardKingdomPrices }) =>
      syncCardKingdomPrices().catch((e) => console.error(e)),
    );
  } else if (job === "fx_rate") {
    void import("@/jobs/fx-rate").then(({ syncFxRate }) =>
      syncFxRate().catch((e) => console.error(e)),
    );
  }
  revalidatePath("/admin");
}

export default async function AdminDashboard() {
  const [stats] = (
    await db.execute(sql`
      select
        (select count(*) from orders where status = 'confirmed' and seen_by_admin = false)::int as new_orders,
        (select count(*) from orders where status in ('pending_confirmation','confirmed'))::int as active_orders,
        (select count(distinct printing_id) from stock where quantity - reserved > 0)::int as stocked_printings,
        (select coalesce(sum(quantity - reserved), 0) from stock)::int as total_copies
    `)
  ).rows as Record<string, number>[];

  const lastRuns = (
    await db.execute(sql`
      select distinct on (job) job, status, started_at, finished_at, message, stats
      from sync_runs
      order by job, started_at desc
    `)
  ).rows as {
    job: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    message: string | null;
    stats: Record<string, unknown> | null;
  }[];

  const pricing = await getPricingContext();
  const D = M.admin.dashboard;

  const cards: [string, string, string][] = [
    [D.newOrders, String(stats.new_orders), "/admin/pedidos"],
    [D.activeOrders, String(stats.active_orders), "/admin/pedidos"],
    [D.stockCards, String(stats.stocked_printings), "/admin/stock"],
    [D.stockValue, String(stats.total_copies), "/admin/stock"],
    [D.fxRate, pricing.fxRate ? pricing.fxRate.toFixed(2) : "—", "/admin/configuracion"],
    [D.multiplier, `× ${pricing.multiplier}`, "/admin/configuracion"],
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value, href]) => (
          <Link
            key={label}
            href={href}
            className="rounded-xl border border-ink/10 bg-white p-4 transition-colors hover:border-felt"
          >
            <p className="text-xs text-ink-faint">{label}</p>
            <p
              className={`font-price mt-1 text-2xl font-semibold ${label === D.newOrders && stats.new_orders > 0 ? "text-danger" : "text-felt"}`}
            >
              {value}
            </p>
          </Link>
        ))}
      </div>

      <h2 className="font-display mt-10 text-lg font-semibold">{D.syncs}</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {lastRuns.map((r) => (
              <tr key={r.job} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">
                  {D.jobNames[r.job] ?? r.job}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.status === "success"
                        ? "bg-felt/10 text-felt"
                        : r.status === "running"
                          ? "bg-foil-soft text-ink"
                          : "bg-danger/10 text-danger"
                    }`}
                  >
                    {D.statusNames[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {new Date(r.started_at).toLocaleString("es-UY")}
                </td>
                <td className="px-4 py-3 text-xs text-ink-faint">
                  {r.message ?? (r.stats ? JSON.stringify(r.stats) : "")}
                </td>
                <td className="px-4 py-3 text-right">
                  {(RUNNABLE_JOBS as readonly string[]).includes(r.job) && (
                    <form action={runJob}>
                      <input type="hidden" name="job" value={r.job} />
                      <button
                        type="submit"
                        disabled={r.status === "running"}
                        className="rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium hover:border-felt disabled:opacity-50"
                      >
                        {r.status === "running" ? D.running : D.runNow}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {RUNNABLE_JOBS.filter((j) => !lastRuns.some((r) => r.job === j)).map(
              (job) => (
                <tr key={job} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-medium">{D.jobNames[job] ?? job}</td>
                  <td className="px-4 py-3 text-xs text-ink-faint">{D.never}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">
                    <form action={runJob}>
                      <input type="hidden" name="job" value={job} />
                      <button
                        type="submit"
                        className="rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium hover:border-felt"
                      >
                        {D.runNow}
                      </button>
                    </form>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
