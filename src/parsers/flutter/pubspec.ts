import fs from "node:fs/promises";
import path from "node:path";

/**
 * Tiny pubspec.yaml reader — we only need name, version, and the names of
 * top-level `dependencies:` entries. Avoids pulling a YAML library.
 */
export async function parsePubspec(repoDir: string): Promise<{
  name: string;
  version: string;
  dependencies: string[];
}> {
  const file = path.join(repoDir, "pubspec.yaml");
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (!raw) return { name: "unknown", version: "0.0.0", dependencies: [] };

  const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
  const version = raw.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? "0.0.0";

  const deps: string[] = [];
  const lines = raw.split("\n");
  let inDeps = false;
  for (const line of lines) {
    if (/^dependencies:\s*$/.test(line)) {
      inDeps = true;
      continue;
    }
    if (inDeps) {
      if (/^\S/.test(line)) break; // dedented out of the block
      const m = line.match(/^\s{2}([a-zA-Z0-9_]+):/);
      if (m?.[1]) deps.push(m[1]);
    }
  }

  return { name, version, dependencies: deps };
}
