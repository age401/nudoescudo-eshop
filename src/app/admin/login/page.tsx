import { redirect } from "next/navigation";
import { checkPassword, createAdminSession, isAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.login.title} — ${M.storeName}` };

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    redirect("/admin/login?error=1");
  }
  await createAdminSession();
  redirect("/admin");
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="font-display text-2xl font-semibold">{M.admin.login.title}</h1>
      <form action={login} className="mt-6 space-y-4">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
            {M.admin.login.wrong}
          </p>
        )}
        <label className="block">
          <span className="text-sm font-medium">{M.admin.login.password}</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper hover:bg-felt-soft"
        >
          {M.admin.login.submit}
        </button>
      </form>
    </div>
  );
}
