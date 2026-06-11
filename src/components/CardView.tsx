"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import type { CardDetail, PrintingDetail, StockEntry } from "@/lib/catalog";
import { M } from "@/lib/messages";
import { computeUnitPriceUsd, formatUsd, formatUyu, usdToUyu } from "@/lib/pricing";

const FINISH_ORDER = ["nonfoil", "foil", "etched"];

function finishLabel(f: string): string {
  if (f === "nonfoil") return M.card.nonfoil;
  if (f === "foil") return M.card.foil;
  return M.card.etched;
}

/**
 * Interactive card page: pick edition (among stocked ones), finish,
 * condition/language variant and quantity, then add to the order.
 */
export function CardView({
  card,
  multiplier,
  fxRate,
}: {
  card: CardDetail;
  multiplier: number;
  fxRate: number | null;
}) {
  const { add } = useCart();

  const stocked = useMemo(
    () => card.printings.filter((p) => p.stock.length > 0),
    [card.printings],
  );
  const hasStock = stocked.length > 0;

  // Default: latest stocked printing, else latest printing for display.
  const fallback = card.printings[card.printings.length - 1] ?? null;
  const [printingId, setPrintingId] = useState<string>(
    (stocked[stocked.length - 1] ?? fallback)?.printingId ?? "",
  );
  const printing: PrintingDetail | null =
    card.printings.find((p) => p.printingId === printingId) ?? fallback;

  const finishesInStock = useMemo(() => {
    const fs = new Set(printing?.stock.map((s) => s.finish));
    return FINISH_ORDER.filter((f) => fs.has(f));
  }, [printing]);

  const [finish, setFinish] = useState<string>(finishesInStock[0] ?? "nonfoil");
  const activeFinish = finishesInStock.includes(finish)
    ? finish
    : (finishesInStock[0] ?? "nonfoil");

  const variants: StockEntry[] =
    printing?.stock.filter((s) => s.finish === activeFinish) ?? [];
  const [variantId, setVariantId] = useState<string>(variants[0]?.stockId ?? "");
  const variant =
    variants.find((v) => v.stockId === variantId) ?? variants[0] ?? null;

  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const priceUsd =
    printing && variant
      ? computeUnitPriceUsd({
          referenceUsd: printing.referencePrices[activeFinish] ?? null,
          overrideUsd: variant.priceOverrideUsd,
          multiplier,
        })
      : null;

  const maxQty = variant?.available ?? 0;
  const clampedQty = Math.min(Math.max(qty, 1), Math.max(maxQty, 1));

  function selectPrinting(id: string) {
    setPrintingId(id);
    const p = card.printings.find((x) => x.printingId === id);
    const fs = FINISH_ORDER.filter((f) => p?.stock.some((s) => s.finish === f));
    const f = fs[0] ?? "nonfoil";
    setFinish(f);
    setVariantId(p?.stock.find((s) => s.finish === f)?.stockId ?? "");
    setQty(1);
    setAdded(false);
  }

  function selectFinish(f: string) {
    setFinish(f);
    setVariantId(printing?.stock.find((s) => s.finish === f)?.stockId ?? "");
    setQty(1);
    setAdded(false);
  }

  function onAdd() {
    if (!printing || !variant || priceUsd == null) return;
    add(
      {
        stockId: variant.stockId,
        cardName: card.name,
        setName: printing.setName,
        finish: variant.finish,
        condition: variant.condition,
        language: variant.language,
        unitPriceUsd: priceUsd,
        imageUrl: printing.imageUris?.small ?? printing.imageUris?.normal ?? null,
        available: variant.available,
        href: `/carta/${card.gameId}/${card.slug}`,
      },
      clampedQty,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  const image = printing?.imageUris?.normal ?? printing?.imageUris?.large ?? null;

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,420px)_1fr]">
      {/* Image */}
      <div>
        <div className="overflow-hidden rounded-2xl shadow-pop">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={card.name}
              className="aspect-[488/680] w-full bg-paper-dim object-cover"
            />
          ) : (
            <div className="flex aspect-[488/680] w-full items-center justify-center bg-paper-dim text-ink-faint">
              {card.name}
            </div>
          )}
        </div>
        {printing?.imageUris?.back && (
          <p className="mt-2 text-center text-xs text-ink-faint">
            Carta de dos caras
          </p>
        )}
      </div>

      {/* Details */}
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-ink-faint">
          {M.card.game[card.gameId] ?? card.gameName}
        </p>
        <h1 className="font-display mt-1 text-3xl font-semibold sm:text-4xl">
          {card.name}
        </h1>
        {printing && (
          <p className="mt-1 text-ink-soft">
            {printing.setName}{" "}
            <span className="font-price text-sm text-ink-faint">
              #{printing.collectorNumber}
            </span>
          </p>
        )}

        {/* Price */}
        <div className="mt-6">
          {hasStock && priceUsd != null ? (
            <div className="flex items-baseline gap-3">
              <span className="font-price text-3xl font-semibold text-felt">
                {formatUsd(priceUsd)}
              </span>
              {fxRate && (
                <span className="font-price text-lg text-ink-faint">
                  ≈ {formatUyu(usdToUyu(priceUsd, fxRate))}
                </span>
              )}
            </div>
          ) : hasStock ? (
            <p className="font-display text-xl">{M.card.noPrice}</p>
          ) : (
            <p className="inline-block rounded-full bg-paper-dim px-4 py-2 text-ink-soft">
              {M.card.outOfStock}
            </p>
          )}
          {hasStock && (
            <p className="mt-1 text-xs text-ink-faint">{M.card.priceReference}</p>
          )}
        </div>

        {hasStock && (
          <>
            {/* Edition selector (stocked editions only) */}
            <div className="mt-8">
              <p className="mb-2 text-sm font-semibold">{M.card.edition}</p>
              <div className="flex flex-wrap gap-2">
                {stocked.map((p) => {
                  const total = p.stock.reduce((n, s) => n + s.available, 0);
                  const selected = p.printingId === printing?.printingId;
                  return (
                    <button
                      key={p.printingId}
                      type="button"
                      onClick={() => selectPrinting(p.printingId)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? "border-felt bg-felt text-paper"
                          : "border-ink/15 bg-white hover:border-felt"
                      }`}
                    >
                      <span className="block font-medium">{p.setName}</span>
                      <span
                        className={`font-price text-xs ${selected ? "text-paper/70" : "text-ink-faint"}`}
                      >
                        #{p.collectorNumber} · {M.search.inStock(total)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Finish toggle */}
            {finishesInStock.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-semibold">{M.card.finish}</p>
                <div className="inline-flex rounded-lg border border-ink/15 bg-white p-1">
                  {finishesInStock.map((f) => {
                    const selected = f === activeFinish;
                    const isFoil = f !== "nonfoil";
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => selectFinish(f)}
                        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                          selected
                            ? isFoil
                              ? "foil-shimmer text-felt-deep"
                              : "bg-felt text-paper"
                            : "text-ink-soft hover:text-ink"
                        }`}
                      >
                        {finishLabel(f)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Condition / language variant */}
            {variants.length > 1 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-semibold">
                  {M.card.condition} / {M.card.language}
                </p>
                <select
                  value={variant?.stockId ?? ""}
                  onChange={(e) => {
                    setVariantId(e.target.value);
                    setQty(1);
                  }}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
                >
                  {variants.map((v) => (
                    <option key={v.stockId} value={v.stockId}>
                      {(M.card.conditions[v.condition] ?? v.condition) +
                        " · " +
                        (M.card.languages[v.language] ?? v.language) +
                        " · " +
                        M.card.available(v.available)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quantity + add */}
            {variant && (
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <div className="flex items-center rounded-lg border border-ink/15 bg-white">
                  <button
                    type="button"
                    aria-label="Menos"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="px-3 py-2 text-lg text-ink-soft hover:text-ink"
                  >
                    −
                  </button>
                  <span className="font-price w-10 text-center text-sm font-semibold">
                    {clampedQty}
                  </span>
                  <button
                    type="button"
                    aria-label="Más"
                    onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                    className="px-3 py-2 text-lg text-ink-soft hover:text-ink"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-ink-faint">
                  {M.card.available(variant.available)}
                </span>
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={priceUsd == null}
                  className="rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper shadow-card transition-all hover:bg-felt-soft disabled:opacity-50"
                >
                  {added ? M.card.added : M.card.addToCart}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
