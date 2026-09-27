import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { resolveBackup } from "@/lib/backups";

/** Admin-only download of one nightly dump (?f=daily/<name>.sql.gz). */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const file = resolveBackup(req.nextUrl.searchParams.get("f") ?? "");
  const stat = file ? await fs.promises.stat(/*turbopackIgnore: true*/ file).catch(() => null) : null;
  if (!file || !stat?.isFile()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
      "Cache-Control": "no-store",
    },
  });
}
