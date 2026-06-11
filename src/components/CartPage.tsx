"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/CartProvider";
import { M } from "@/lib/messages";
import { formatUsd, formatUyu, round2, usdToUyu } from "@/lib/pricing";

type Phase = "cart" | "form" | "sent";

export function CartPage({ fxRate }: { fxRate: number | null }) {
  const { items, totalUsd, setQuantity, remove, clear } = useCart();
  const [phase, setPhase] = useState<Phase>("cart");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [stockIssues, setStockIssues] = useState<Record<string, number>>({});

  const total = round2(totalUsd);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          customerName: name || undefined,
          phone: phone || undefined,
          items: items.map((i) => ({ stockId: i.stockId, quantity: i.quantity })),
        }),
      });
      if (res.status === 201) {
        setSentTo(email);
        setPhase("sent");
        clear();
        return;
      }
      if (res.status === 409) {
        const data = await res.json();
        const issues: Record<string, number> = {};
        for (const p of data.problems ?? []) issues[p.stockId] = p.available;
        setStockIssues(issues);
        // Clamp quantities to what's actually available.
        for (const p of data.problems ?? []) {
          if (p.available <= 0) remove(p.stockId);
          else setQuantity(p.stockId, p.available);
        }
        setPhase("cart");
        setError(M.cart.stockChanged);
        return;
      }
      setError(M.errors.generic);
    } catch {
      setError(M.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "sent") {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-foil-soft text-3xl">
          ✉️
        </div>
        <h1 className="font-display mt-6 text-3xl font-semibold">
          {M.orderStatus.pendingTitle}
        </h1>
        <p className="mt-3 text-ink-soft">{M.orderStatus.pendingBody(sentTo)}</p>
        <Link
          href="/"
          className="mt-10 inline-block rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper hover:bg-felt-soft"
        >
          {M.cart.continueShopping}
        </Link>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold">{M.cart.title}</h1>
        <p className="mt-4 text-ink-soft">{M.cart.empty}</p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper hover:bg-felt-soft"
        >
          {M.cart.continueShopping}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-semibold">{M.cart.title}</h1>

      {error && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="mt-6 divide-y divide-ink/10">
        {items.map((item) => {
          const issue = stockIssues[item.stockId];
          return (
            <li key={item.stockId} className="flex items-center gap-4 py-4">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.cardName}
                  className="w-14 shrink-0 rounded-md shadow-card"
                />
              ) : (
                <div className="aspect-[488/680] w-14 shrink-0 rounded-md bg-paper-dim" />
              )}
              <div className="min-w-0 flex-1">
                <Link href={item.href} className="font-medium hover:underline">
                  {item.cardName}
                </Link>
                <p className="text-xs text-ink-faint">
                  {item.setName} · {item.finish === "nonfoil" ? M.card.nonfoil : M.card.foil}
                  {" · "}
                  {M.card.conditions[item.condition] ?? item.condition}
                  {" · "}
                  {(M.card.languages[item.language] ?? item.language).toString()}
                </p>
                {issue != null && (
                  <p className="text-xs font-medium text-danger">
                    {M.card.available(issue)}
                  </p>
                )}
              </div>
              <div className="flex items-center rounded-lg border border-ink/15 bg-white">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => setQuantity(item.stockId, item.quantity - 1)}
                  className="px-2.5 py-1.5 text-ink-soft hover:text-ink"
                >
                  −
                </button>
                <span className="font-price w-8 text-center text-sm">{item.quantity}</span>
                <button
                  type="button"
                  aria-label="Más"
                  onClick={() =>
                    setQuantity(item.stockId, Math.min(item.quantity + 1, item.available))
                  }
                  className="px-2.5 py-1.5 text-ink-soft hover:text-ink"
                >
                  +
                </button>
              </div>
              <p className="font-price w-24 text-right text-sm font-semibold">
                {formatUsd(round2(item.unitPriceUsd * item.quantity))}
              </p>
              <button
                type="button"
                onClick={() => remove(item.stockId)}
                aria-label={M.cart.remove}
                className="text-ink-faint transition-colors hover:text-danger"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9l1-13M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-baseline justify-between border-t border-ink/10 pt-4">
        <span className="font-display text-lg font-semibold">{M.cart.total}</span>
        <span className="font-price text-2xl font-semibold text-felt">
          {formatUsd(total)}
          {fxRate && (
            <span className="ml-2 text-base font-normal text-ink-faint">
              ≈ {formatUyu(usdToUyu(total, fxRate))}
            </span>
          )}
        </span>
      </div>

      {phase === "cart" ? (
        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <Link
            href="/"
            className="rounded-lg border border-ink/15 px-6 py-3 text-sm font-medium hover:border-felt"
          >
            {M.cart.continueShopping}
          </Link>
          <button
            type="button"
            onClick={() => setPhase("form")}
            className="rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper shadow-card hover:bg-felt-soft"
          >
            {M.cart.checkout}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 rounded-2xl bg-paper-dim p-6">
          <h2 className="font-display text-xl font-semibold">{M.checkout.title}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">{M.checkout.email} *</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
              />
              <span className="mt-1 block text-xs text-ink-faint">
                {M.checkout.emailHelp}
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">{M.checkout.name}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">{M.checkout.phone}</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
              />
            </label>
          </div>
          <p className="mt-4 text-xs text-ink-faint">{M.checkout.legal}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPhase("cart")}
              className="rounded-lg border border-ink/15 px-6 py-3 text-sm font-medium hover:border-felt"
            >
              ←
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper shadow-card hover:bg-felt-soft disabled:opacity-60"
            >
              {submitting ? M.checkout.submitting : M.checkout.submit}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
