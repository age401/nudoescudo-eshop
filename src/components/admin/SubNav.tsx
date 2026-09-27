"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Section tabs; a tab is active on its own path and anything below it. */
export function SubNav({ links }: { links: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-ink/10 text-sm">
      {links.map((l) => {
        const active = l.exact ? path === l.href : path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              active ? "border-felt text-felt" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
