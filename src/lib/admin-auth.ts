import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireEnv } from "@/lib/env";
import { signSession, verifySession } from "@/lib/tokens";

const COOKIE = "ne_admin";
const SESSION_DAYS = 30;

export function checkPassword(password: string): boolean {
  return password.length > 0 && password === requireEnv("ADMIN_PASSWORD");
}

export async function createAdminSession(): Promise<void> {
  const expires = Date.now() + SESSION_DAYS * 24 * 3600_000;
  const jar = await cookies();
  jar.set(COOKIE, signSession(`admin.${expires}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 3600,
    path: "/",
  });
}

export async function destroyAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const value = verifySession(jar.get(COOKIE)?.value);
  if (!value) return false;
  const [tag, expires] = value.split(".");
  return tag === "admin" && Number(expires) > Date.now();
}

/** Guard for admin pages/actions: redirects to the login screen. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
