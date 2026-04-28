import type { DartFile } from "./walk.ts";

/**
 * For every Dart class in the source set, return the set of other-class names
 * it references — primarily as field types (`final FooBar baz;`,
 * `final FooBar baz = ...`) and as constructor parameter types (`Cls(this.foo)`
 * resolves to whatever type `foo` was declared as on the class).
 *
 * Additionally, for every interface used in `extends` / `implements` clauses,
 * we add an edge from the interface to its implementer. This lets the
 * cross-repo analyzer follow `LoginCubit → UserRepository (abstract) →
 * UserRepositoryImpl → ... → EsmorgaAuthApi (HTTP)`, which is the actual chain
 * Esmorga uses (and a common Flutter/Dart convention).
 *
 * Pure heuristic: anything matching PascalCase is treated as a class name.
 * False positives don't matter — they just don't resolve to a known class
 * downstream.
 */
const CLASS_HEAD_RE = /class\s+(\w+)\s*(?:<[^>]+>)?\s*(?:extends\s+(\w+)(?:<[^>]+>)?)?\s*(?:implements\s+([\w\s,<>?]+?))?\s*\{/g;

const FIELD_TYPE_RE =
  /(?:^|\n)\s*(?:final\s+|late\s+(?:final\s+)?|const\s+|static\s+(?:final\s+|const\s+)?)?([A-Z]\w+)(?:<[^>]+>)?[?\s]+\w+\s*[;=({]/g;

export function parseClassRefs(files: DartFile[]): Record<string, string[]> {
  const refs: Record<string, Set<string>> = {};

  for (const f of files) {
    CLASS_HEAD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLASS_HEAD_RE.exec(f.source))) {
      const name = match[1];
      if (!name) continue;

      const set = (refs[name] ??= new Set());
      const body = sliceClassBody(f.source, match.index);
      if (body) {
        FIELD_TYPE_RE.lastIndex = 0;
        let r: RegExpExecArray | null;
        while ((r = FIELD_TYPE_RE.exec(body))) {
          const refName = r[1];
          if (!refName) continue;
          if (refName === name) continue;
          if (PRIMITIVES.has(refName)) continue;
          set.add(refName);
        }
      }

      // Interface → implementation edge: when class X extends/implements Y,
      // record X as a "ref" of Y so a BFS rooted at the abstract type reaches
      // the concrete one.
      const ext = match[2];
      if (ext && !PRIMITIVES.has(ext)) {
        (refs[ext] ??= new Set()).add(name);
      }
      const impl = match[3];
      if (impl) {
        for (const piece of impl.split(",")) {
          const ifaceName = piece.replace(/<[^>]*>/g, "").trim();
          if (!ifaceName || PRIMITIVES.has(ifaceName)) continue;
          (refs[ifaceName] ??= new Set()).add(name);
        }
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(refs)) out[k] = [...v].sort();
  return out;
}

const PRIMITIVES = new Set([
  "String",
  "Int",
  "Integer",
  "Bool",
  "Boolean",
  "Double",
  "Float",
  "Future",
  "List",
  "Map",
  "Set",
  "Stream",
  "Iterable",
  "Object",
  "Function",
  "Never",
  "Null",
  "Void",
  "DateTime",
  "Duration",
  "Uri",
  "Uint8List",
]);

function sliceClassBody(source: string, classIdx: number): string {
  const open = source.indexOf("{", classIdx);
  if (open === -1) return "";
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch as '"' | "'";
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}
