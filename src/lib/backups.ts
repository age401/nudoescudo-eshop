/**
 * Read-only view of the nightly database dumps.
 *
 * The `backup` service in docker-compose.yml (prodrigestivill/postgres-backup-local)
 * writes <db>-YYYYMMDD.sql.gz files into daily/, weekly/ and monthly/ under
 * ./backups; that folder is mounted read-only into the app at BACKUP_DIR so
 * the admin panel can show and download them. Off-site copies are made by
 * deploy/backup-offsite.sh, outside the app.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const BACKUP_KINDS = ["daily", "weekly", "monthly"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** A dump is stale when the newest daily one is older than this. */
export const STALE_AFTER_HOURS = 36;

export type BackupFile = {
  kind: BackupKind;
  name: string;
  /** Relative path used by the download route, e.g. daily/x.sql.gz */
  rel: string;
  size: number;
  modifiedAt: Date;
};

const FILE_RE = /^[\w.-]+\.sql\.gz$/;

export function backupDir(): string | null {
  const dir = process.env.BACKUP_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export async function listBackups(): Promise<{ configured: boolean; files: BackupFile[] }> {
  const dir = backupDir();
  if (!dir) return { configured: false, files: [] };
  const files: BackupFile[] = [];
  for (const kind of BACKUP_KINDS) {
    let names: string[];
    try {
      names = await fs.readdir(path.join(dir, kind));
    } catch {
      continue;
    }
    for (const name of names) {
      // Skip the "-latest" symlinks: they duplicate a dated file.
      if (!FILE_RE.test(name) || name.includes("-latest")) continue;
      const stat = await fs.stat(path.join(dir, kind, name)).catch(() => null);
      if (!stat?.isFile()) continue;
      files.push({ kind, name, rel: `${kind}/${name}`, size: stat.size, modifiedAt: stat.mtime });
    }
  }
  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return { configured: true, files };
}

/** Freshness of the newest dump, for the dashboard warning. */
export async function backupHealth(): Promise<
  { state: "unconfigured" } | { state: "missing" } | { state: "ok" | "stale"; newest: BackupFile; ageHours: number }
> {
  const { configured, files } = await listBackups();
  if (!configured) return { state: "unconfigured" };
  const newest = files[0];
  if (!newest) return { state: "missing" };
  const ageHours = (Date.now() - newest.modifiedAt.getTime()) / 3600_000;
  return { state: ageHours > STALE_AFTER_HOURS ? "stale" : "ok", newest, ageHours };
}

/**
 * Resolves a download request to a file inside BACKUP_DIR, or null. Only
 * `<kind>/<name>.sql.gz` is accepted, so nothing else on disk is reachable.
 */
export function resolveBackup(rel: string): string | null {
  const dir = backupDir();
  if (!dir) return null;
  const [kind, name, ...rest] = rel.split("/");
  if (rest.length || !BACKUP_KINDS.includes(kind as BackupKind) || !name || !FILE_RE.test(name)) {
    return null;
  }
  const full = path.resolve(dir, kind, name);
  return full.startsWith(dir + path.sep) ? full : null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * deploy/backup-offsite.sh writes `<ISO date> <remote>` to this file after a
 * successful sync, so the panel can tell whether copies are leaving the server.
 */
export async function offsiteStatus(): Promise<{ at: Date; remote: string; ageHours: number } | null> {
  const dir = backupDir();
  if (!dir) return null;
  const text = await fs.readFile(path.join(dir, ".offsite-last-ok"), "utf8").catch(() => null);
  if (!text) return null;
  const [iso, ...remote] = text.trim().split(/\s+/);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return { at, remote: remote.join(" "), ageHours: (Date.now() - at.getTime()) / 3600_000 };
}
