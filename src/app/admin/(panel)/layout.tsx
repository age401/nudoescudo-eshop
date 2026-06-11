import Link from "next/link";
import { redirect } from "next/navigation";
import { destroyAdminSession, requireAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";

async function logout() {
  "use server";
  await destroyAdminSession();
  redirect("/admin/login");
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  const links = [
    ["/admin", M.admin.nav.dashboard],
    ["/admin/pedidos", M.admin.nav.orders],
    ["/admin/stock", M.admin.nav.stock],
    ["/admin/configuracion", M.admin.nav.settings],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-4">
        <h1 className="font-display text-xl font-semibold">{M.admin.title}</h1>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg px-3 py-1.5 font-medium text-ink-soft hover:bg-paper-dim hover:text-ink"
            >
              {label}
            </Link>
          ))}
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-ink-faint hover:bg-paper-dim"
          >
            {M.admin.nav.viewStore}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-ink-faint hover:bg-paper-dim hover:text-danger"
            >
              {M.admin.nav.logout}
            </button>
          </form>
        </nav>
      </div>
      <div className="py-6">{children}</div>
    </div>
  );
}
