"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { M } from "@/lib/messages";

export function CartButton() {
  const { count } = useCart();
  return (
    <Link
      href="/pedido"
      aria-label={M.cart.title}
      className="relative flex shrink-0 items-center gap-2 rounded-full border border-paper/25 px-4 py-2 text-sm text-paper transition-colors hover:border-foil hover:text-foil-soft"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3 4h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="21" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="17.5" cy="21" r="1.2" fill="currentColor" stroke="none" />
      </svg>
      <span className="hidden sm:inline">{M.cart.title}</span>
      {count > 0 && (
        <span className="font-price absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-foil px-1 text-xs font-semibold text-felt-deep">
          {count}
        </span>
      )}
    </Link>
  );
}
