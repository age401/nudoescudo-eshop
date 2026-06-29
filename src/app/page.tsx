import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { getFeaturedStock } from "@/lib/catalog";
import { M } from "@/lib/messages";
import { computeUnitPriceUsd, formatUsd, formatUyu, usdToUyu } from "@/lib/pricing";
import { getPricingContext } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [featured, pricing] = await Promise.all([
    getFeaturedStock(12),
    getPricingContext(),
  ]);

  return (
    <div>
      {/* Hero */}
      <section className="bg-felt text-paper">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:pt-20">
          <h1 className="font-display max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            La carta que te falta,
            <span className="text-foil"> acá está.</span>
          </h1>
          <p className="mt-3 max-w-xl text-paper/80">{M.tagline}</p>
          <div className="mt-8 max-w-2xl text-ink">
            <SearchBar variant="hero" />
          </div>
        </div>
      </section>

      {/* Featured in-stock */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="font-display text-2xl font-semibold">Recién llegadas</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Cartas en stock, listas para tu pedido.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((f, i) => {
              const price = computeUnitPriceUsd({
                referenceUsd: f.referenceUsd,
                overrideUsd: f.overrideUsd,
                multiplier: pricing.multiplier,
                minimumUsd: pricing.minimumUsd,
              });
              return (
                <Link
                  key={f.cardId}
                  href={`/carta/${f.gameId}/${f.slug}`}
                  className="rise-in group"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <div className="overflow-hidden rounded-xl shadow-card transition-transform duration-200 group-hover:-translate-y-1 group-hover:rotate-[0.6deg]">
                    {f.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.imageUrl}
                        alt={f.name}
                        loading="lazy"
                        className="aspect-[488/680] w-full bg-paper-dim object-cover"
                      />
                    ) : (
                      <div className="aspect-[488/680] w-full bg-paper-dim" />
                    )}
                  </div>
                  <div className="mt-2 px-1">
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className="truncate text-xs text-ink-faint">{f.setName}</p>
                    <p className="font-price mt-1 text-sm font-semibold text-felt">
                      {price != null ? (
                        <>
                          {formatUsd(price)}
                          {pricing.fxRate && (
                            <span className="ml-2 font-normal text-ink-faint">
                              ≈ {formatUyu(usdToUyu(price, pricing.fxRate))}
                            </span>
                          )}
                        </>
                      ) : (
                        M.card.noPrice
                      )}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="grid gap-4 rounded-2xl bg-paper-dim p-6 sm:grid-cols-3 sm:p-8">
          {[
            ["1. Buscá", "Encontrá la carta entre todas las ediciones y elegí la que tenemos en stock."],
            ["2. Armá tu pedido", "Agregá cantidades y revisá el total en dólares y pesos."],
            ["3. Confirmá por email", "Te enviamos un enlace para confirmar. Reservamos tus cartas y coordinamos la entrega."],
          ].map(([title, body]) => (
            <div key={title}>
              <p className="font-display text-lg font-semibold">{title}</p>
              <p className="mt-1 text-sm text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
