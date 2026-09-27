import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBackups, offsiteStatus, resolveBackup } from "./backups";

let dir: string;
const saved = process.env.BACKUP_DIR;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "backups-"));
  fs.mkdirSync(path.join(dir, "daily"));
  fs.mkdirSync(path.join(dir, "monthly"));
  fs.writeFileSync(path.join(dir, "daily", "nudoescudo-20260926.sql.gz"), "a");
  fs.writeFileSync(path.join(dir, "daily", "nudoescudo-latest.sql.gz"), "a");
  fs.writeFileSync(path.join(dir, "monthly", "nudoescudo-202609.sql.gz"), "bb");
  fs.writeFileSync(path.join(dir, "secret.txt"), "no");
  fs.writeFileSync(path.join(dir, ".offsite-last-ok"), "2026-09-27T03:30:00Z b2:nudo-backups\n");
  process.env.BACKUP_DIR = dir;
});

afterAll(() => {
  process.env.BACKUP_DIR = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("backups", () => {
  it("lists dated dumps, skipping -latest links and other files", async () => {
    const { configured, files } = await listBackups();
    expect(configured).toBe(true);
    expect(files.map((f) => f.rel).sort()).toEqual([
      "daily/nudoescudo-20260926.sql.gz",
      "monthly/nudoescudo-202609.sql.gz",
    ]);
  });

  it("only resolves <kind>/<name>.sql.gz inside the folder", () => {
    expect(resolveBackup("daily/nudoescudo-20260926.sql.gz")).toBe(
      path.join(dir, "daily", "nudoescudo-20260926.sql.gz"),
    );
    for (const bad of ["../secret.txt", "daily/../secret.txt", "secret.txt", "daily/x.txt", "etc/passwd.sql.gz", "daily/a/b.sql.gz", ""]) {
      expect(resolveBackup(bad)).toBeNull();
    }
  });

  it("reads the off-site marker", async () => {
    expect(await offsiteStatus()).toMatchObject({ remote: "b2:nudo-backups" });
  });
});
