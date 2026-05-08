// Reads `prose.json` from stdin (a JSON object mapping file paths to prose
// strings), then for each entry replaces the single `> TODO (...): run ...`
// line in that MDX file with the prose. Writes back in place. Exits non-zero
// if any file is missing the TODO marker.
import fs from "node:fs/promises";
import path from "node:path";

const proseFile = process.argv[2];
if (!proseFile) {
  console.error("usage: node fill-prose.mjs <prose.json>");
  process.exit(2);
}

const raw = await fs.readFile(proseFile, "utf8");
const map = JSON.parse(raw);

const TODO_RE = /^> TODO \([^)]+\): run `npm run generate` with `ANTHROPIC_API_KEY` set to fill this in\.$/m;

let updated = 0;
let missed = 0;
for (const [rel, prose] of Object.entries(map)) {
  const abs = path.resolve(rel);
  const before = await fs.readFile(abs, "utf8");
  if (!TODO_RE.test(before)) {
    console.error(`! no TODO marker in ${rel}`);
    missed++;
    continue;
  }
  const after = before.replace(TODO_RE, prose);
  await fs.writeFile(abs, after);
  updated++;
}
console.log(`updated ${updated}, missed ${missed}`);
process.exit(missed ? 1 : 0);
