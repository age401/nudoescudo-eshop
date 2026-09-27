import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// Runtime path, not a build dependency: the ignore hint stops Turbopack's
// file tracing (NFT) from tracing the whole project.
export const CACHE_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.CACHE_DIR ?? ".local/cache",
);

const USER_AGENT = "NudoEscudoShop/1.0 (small card shop in Uruguay)";

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Download `url` to a file in CACHE_DIR (decompressing .gz on the fly).
 * Returns the local path. Skips the download when a file newer than
 * `maxAgeHours` already exists.
 */
export async function downloadToCache(
  url: string,
  fileName: string,
  maxAgeHours: number,
): Promise<string> {
  fs.mkdirSync(/*turbopackIgnore: true*/ CACHE_DIR, { recursive: true });
  const dest = path.join(/*turbopackIgnore: true*/ CACHE_DIR, fileName);

  if (fs.existsSync(/*turbopackIgnore: true*/ dest)) {
    const ageMs = Date.now() - fs.statSync(/*turbopackIgnore: true*/ dest).mtimeMs;
    if (ageMs < maxAgeHours * 3600_000) return dest;
  }

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);

  const tmp = `${dest}.download`;
  const source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  if (url.endsWith(".gz")) {
    await pipeline(source, zlib.createGunzip(), fs.createWriteStream(/*turbopackIgnore: true*/ tmp));
  } else {
    await pipeline(source, fs.createWriteStream(/*turbopackIgnore: true*/ tmp));
  }
  fs.renameSync(/*turbopackIgnore: true*/ tmp, dest);
  return dest;
}
