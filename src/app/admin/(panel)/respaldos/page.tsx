import { M } from "@/lib/messages";
import { backupHealth, formatBytes, listBackups, offsiteStatus } from "@/lib/backups";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.backups.title} — ${M.storeName}` };

const B = M.admin.backups;
const OFFSITE_STALE_HOURS = 48;

function ago(hours: number): string {
  if (hours < 1) return "menos de una hora";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} días`;
}

const when = (d: Date) => d.toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" });

function Status({ tone, label, text }: { tone: "ok" | "bad" | "warn"; label: string; text: string }) {
  const cls = { ok: "border-felt/30 bg-felt/5", bad: "border-danger/40 bg-danger/5", warn: "border-foil/50 bg-foil-soft/40" }[tone];
  const icon = { ok: "✓", bad: "✕", warn: "⚠" }[tone];
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      <p className={`mt-1 text-sm ${tone === "bad" ? "font-medium text-danger" : ""}`}>
        {icon} {text}
      </p>
    </div>
  );
}

export default async function BackupsPage() {
  const [{ configured, files }, health, offsite] = await Promise.all([
    listBackups(),
    backupHealth(),
    offsiteStatus(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold">{B.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{B.intro}</p>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        {health.state === "ok" && <Status tone="ok" label={B.lastDump} text={B.ok(ago(health.ageHours))} />}
        {health.state === "stale" && <Status tone="bad" label={B.lastDump} text={B.stale(ago(health.ageHours))} />}
        {health.state === "missing" && <Status tone="bad" label={B.lastDump} text={B.missing} />}
        {health.state === "unconfigured" && <Status tone="warn" label={B.lastDump} text={B.unconfigured} />}
        {offsite ? (
          offsite.ageHours > OFFSITE_STALE_HOURS ? (
            <Status tone="bad" label={B.offsite} text={B.offsiteStale(when(offsite.at))} />
          ) : (
            <Status tone="ok" label={B.offsite} text={B.offsiteOk(when(offsite.at), offsite.remote)} />
          )
        ) : (
          <Status tone="warn" label={B.offsite} text={B.offsiteNone} />
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h3 className="font-display font-semibold">{B.exportsTitle}</h3>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{B.exportsHelp}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/admin/stock/export" className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-medium hover:border-felt">
            ⬇ {B.stockAll}
          </a>
          <a href="/api/admin/stock/export?juego=mtg" className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-medium hover:border-felt">
            ⬇ {B.stockMtg}
          </a>
        </div>
      </section>

      {configured && (
        <section>
          <h3 className="font-display font-semibold">{B.listTitle}</h3>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">{B.listHelp}</p>
          {files.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">{B.none}</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                    <th className="px-4 py-3">{B.date}</th>
                    <th className="px-4 py-3">{B.type}</th>
                    <th className="px-4 py-3 text-right">{B.size}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.rel} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-2">
                        {when(f.modifiedAt)} <span className="ml-2 text-xs text-ink-faint">{f.name}</span>
                      </td>
                      <td className="px-4 py-2 text-xs">{B.kind[f.kind]}</td>
                      <td className="font-price px-4 py-2 text-right text-ink-soft">{formatBytes(f.size)}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={`/api/admin/backups/download?f=${encodeURIComponent(f.rel)}`}
                          className="text-xs font-medium text-felt hover:underline"
                        >
                          ⬇ {B.download}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
