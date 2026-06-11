/**
 * Downloads (once) and runs Mailpit, a local SMTP server with a web UI to
 * inspect outgoing emails during development.
 *
 * SMTP: localhost:1025 — Web UI: http://localhost:8025
 * Usage: npm run mail:dev   (keeps running; Ctrl+C to stop)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const VERSION = "v1.27.10";
const BIN_DIR = path.resolve(".local/bin");

function assetName(): string {
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `mailpit-${os}-${arch}.zip`;
}

async function ensureBinary(): Promise<string> {
  const exe = path.join(BIN_DIR, process.platform === "win32" ? "mailpit.exe" : "mailpit");
  if (fs.existsSync(exe)) return exe;

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const url = `https://github.com/axllent/mailpit/releases/download/${VERSION}/${assetName()}`;
  console.log(`Downloading Mailpit ${VERSION}...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
  const zipPath = path.join(BIN_DIR, "mailpit.zip");
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(zipPath));

  // Extract using built-in OS tools to avoid extra dependencies.
  const { execSync } = await import("node:child_process");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`,
    );
  } else {
    execSync(`unzip -o '${zipPath}' -d '${BIN_DIR}'`);
    fs.chmodSync(exe, 0o755);
  }
  fs.rmSync(zipPath);
  return exe;
}

async function main() {
  const exe = await ensureBinary();
  console.log("Mailpit: SMTP on localhost:1025 — Web UI on http://localhost:8025");
  const child = spawn(exe, ["--smtp", "0.0.0.0:1025", "--listen", "0.0.0.0:8025"], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
