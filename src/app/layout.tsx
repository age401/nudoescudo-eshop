import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { M } from "@/lib/messages";
import { CartProvider } from "@/components/CartProvider";
import { CartButton } from "@/components/CartButton";
import { SearchBar } from "@/components/SearchBar";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: `${M.storeName} — ${M.tagline}`,
  description:
    "Tienda de cartas sueltas de Magic: The Gathering y Pokémon en Uruguay. Buscá, armá tu pedido y retiralo en la tienda.",
};

function KnotMark() {
  // Simple interlaced-knot mark (nudo + escudo).
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
      <path
        d="M16 2 28 7v9c0 7.5-5.2 11.9-12 14C9.2 27.9 4 23.5 4 16V7l12-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M11 12c5-4 10 2 5 6s0 10 5 6M21 12c-5-4-10 2-5 6s0 10-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${fraunces.variable} ${instrument.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CartProvider>
          <header className="bg-felt text-paper shadow-pop sticky top-0 z-40">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
              <Link
                href="/"
                className="flex shrink-0 items-center gap-2 text-paper hover:text-foil-soft transition-colors"
              >
                <KnotMark />
                <span className="font-display text-xl font-semibold tracking-tight">
                  {M.storeName}
                </span>
              </Link>
              <div className="min-w-0 flex-1">
                <SearchBar variant="header" />
              </div>
              <Link
                href="/catalogo"
                className="hidden shrink-0 rounded-full px-3 py-2 text-sm font-medium text-paper/90 transition-colors hover:text-foil-soft sm:inline-flex"
              >
                {M.catalog.title}
              </Link>
              <CartButton />
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="bg-felt-deep text-paper/70 mt-16">
            <div className="mx-auto max-w-6xl px-4 py-8 text-sm">
              <p className="font-display text-base text-paper">{M.storeName}</p>
              <p className="mt-2">{M.footer.pricesNote}</p>
            </div>
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
