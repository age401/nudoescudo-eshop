import Link from "next/link";
import { redirect } from "next/navigation";
import { getEnabledGames } from "@/lib/catalog";
import { M } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.catalog.title} — ${M.storeName}` };

export default async function CatalogIndexPage() {
  const games = await getEnabledGames();
  // With a single game there is no choice to make — go straight to it.
  if (games.length === 1) redirect(`/catalogo/${games[0].id}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl font-semibold">{M.catalog.title}</h1>
      <p className="mt-2 text-ink-soft">{M.catalog.intro}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {games.map((g) => (
          <Link
            key={g.id}
            href={`/catalogo/${g.id}`}
            className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card transition-transform hover:-translate-y-0.5 hover:border-felt"
          >
            <p className="font-display text-xl font-semibold">
              {M.card.game[g.id] ?? g.name}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{M.catalog.browseAll} →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
