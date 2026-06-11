import crypto from "node:crypto";
import { loadEnv, requireEnv } from "@/lib/env";

loadEnv();

/** Random url-safe token for order confirmation links. */
export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Short human-friendly order code, e.g. "NE-7K3FA2". */
export function orderCode(): string {
  // Unambiguous alphabet (no 0/O, 1/I/L).
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  const buf = crypto.randomBytes(6);
  for (const b of buf) out += alphabet[b % alphabet.length];
  return `NE-${out}`;
}

/** HMAC for the admin session cookie. */
export function signSession(value: string): string {
  const h = crypto
    .createHmac("sha256", requireEnv("APP_SECRET"))
    .update(value)
    .digest("base64url");
  return `${value}.${h}`;
}

export function verifySession(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = signSession(value);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
