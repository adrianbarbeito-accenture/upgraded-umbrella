import fs from "node:fs/promises";
import path from "node:path";

export type DartFile = {
  /** path relative to the repo root (always forward-slash) */
  rel: string;
  /** absolute path on disk */
  abs: string;
  source: string;
  /** feature folder, e.g. "auth" / "events" / "profile". Best-effort. */
  feature: string;
};

const SKIP_DIRS = new Set([".dart_tool", ".git", "build", "ios", "android", "linux", "macos", "windows", "web", "test"]);

export async function walkDartFiles(repoDir: string): Promise<DartFile[]> {
  const libDir = path.join(repoDir, "lib");
  const stat = await fs.stat(libDir).catch(() => null);
  if (!stat?.isDirectory()) return [];

  const out: DartFile[] = [];
  await walk(libDir);
  return out;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile() && e.name.endsWith(".dart")) {
        const source = await fs.readFile(abs, "utf8");
        const rel = path.relative(repoDir, abs).split(path.sep).join("/");
        out.push({ rel, abs, source, feature: featureFromPath(rel) });
      }
    }
  }
}

/**
 * Feature is the segment immediately after `lib/features/` if present, otherwise the
 * top-level segment under `lib/`. Falls back to "core".
 */
function featureFromPath(rel: string): string {
  const parts = rel.split("/");
  const libIdx = parts.indexOf("lib");
  if (libIdx === -1) return "core";
  const tail = parts.slice(libIdx + 1);
  if (tail[0] === "features" && tail[1]) return tail[1];
  if (tail[0] === "src" && tail[1] === "features" && tail[2]) return tail[2];
  return tail[0] ?? "core";
}
