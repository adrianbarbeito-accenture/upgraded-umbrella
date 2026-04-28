import type { FlutterCubit } from "../../types.ts";
import type { DartFile } from "./walk.ts";

const CUBIT_CLASS_RE = /class\s+(\w+Cubit)\s+extends\s+Cubit<\s*(\w+)\s*>/g;
const STATE_CLASS_RE = /class\s+(\w+State)\b/g;

export function parseCubits(files: DartFile[]): FlutterCubit[] {
  const out: FlutterCubit[] = [];

  for (const f of files) {
    CUBIT_CLASS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CUBIT_CLASS_RE.exec(f.source))) {
      const name = match[1];
      const stateType = match[2];
      if (!name) continue;
      out.push({
        name,
        file: f.rel,
        feature: f.feature,
        states: collectStates(f.source, stateType),
        emits: collectEmits(f.source),
        repositories: collectRepositories(f.source),
        invokes: collectInvokes(f.source),
      });
    }
  }

  out.sort((a, b) => a.feature.localeCompare(b.feature) || a.name.localeCompare(b.name));
  return out;
}

function collectStates(source: string, baseStateType: string | undefined): string[] {
  const seen = new Set<string>();
  if (baseStateType) seen.add(baseStateType);
  STATE_CLASS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATE_CLASS_RE.exec(source))) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen].sort();
}

function collectEmits(source: string): string[] {
  const seen = new Set<string>();
  for (const m of source.matchAll(/\bemit\s*\(\s*(?:const\s+)?(\w+)/g)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen].sort();
}

/**
 * Collects names of dependencies the cubit reaches outward to. Field name
 * stays `repositories` for backwards compat, but the set is broader: it
 * includes any `*Repository`, `*Api`, `*ApiClient`, `*Datasource`,
 * `*DataSource`, or `*Service` referenced anywhere in the cubit body.
 */
function collectRepositories(source: string): string[] {
  const seen = new Set<string>();
  for (const m of source.matchAll(
    /\b(\w+(?:Repository|ApiClient|Api|Datasource|DataSource|Service))\b/g,
  )) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen].sort();
}

/**
 * Collects method names invoked on any object in the cubit body — patterns
 * like `userRepository.login(`, `_validator.validateEmail(`, `await
 * _repo.fetch(`. We don't try to resolve the receiver to a class; for the
 * cross-repo linker, the *method name* alone is enough to intersect against
 * the names of HTTP-call methods in the reachable graph (the codebase keeps
 * names consistent across the Cubit → Repository → Datasource → Api chain).
 */
function collectInvokes(source: string): string[] {
  const seen = new Set<string>();
  for (const m of source.matchAll(/\b\w+\.(\w+)\s*\(/g)) {
    if (m[1] && /^[a-z]/.test(m[1])) seen.add(m[1]);
  }
  // Skip extremely common Dart helpers that would just add noise.
  for (const drop of ["toString", "toList", "toMap", "toJson", "fromJson", "where", "map", "forEach", "copyWith"]) {
    seen.delete(drop);
  }
  return [...seen].sort();
}
