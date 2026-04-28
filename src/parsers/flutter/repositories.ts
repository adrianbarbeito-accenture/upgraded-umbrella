import type { FlutterRepository, HttpCall, HttpMethod } from "../../types.ts";
import type { DartFile } from "./walk.ts";

/**
 * Find every Dart class that issues HTTP calls and extract those calls,
 * resolving the most common path-interpolation patterns we see in this
 * codebase:
 *
 *   const x = await client.post(Uri.parse('$baseUrl$eventsEndpoint'));
 *   const x = await client.get(Uri.parse('${baseUrl}account/password'));
 *   const x = await client.get('/v1/events');
 *
 * To resolve `$x` and `${x}`, we collect string field assignments declared in
 * the same class (e.g. `String eventsEndpoint = 'account/events';`) and
 * substitute them. `$baseUrl` collapses to empty since the swagger paths the
 * generator matches against don't include the host.
 */
const CLASS_HEAD_RE = /class\s+(\w+)\b/g;

const HTTP_CALL_RE =
  /\b(?:_?\w+|http)\.(get|post|put|patch|delete|options|head)\s*\(\s*(?:Uri\.parse\(\s*)?(['"])([^'"]+)\2/g;

const HTTP_REQUEST_RE = /\bhttp\.Request\(\s*(['"])(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\1\s*,\s*Uri\.parse\(\s*(['"])([^'"]+)\3/g;

const STRING_FIELD_RE =
  /(?:^|\n)\s*(?:final\s+|const\s+|static\s+(?:final\s+|const\s+)?)?String[?\s]+(\w+)\s*=\s*(['"])([^'"]+)\2/g;

export function parseRepositories(files: DartFile[]): FlutterRepository[] {
  const out: FlutterRepository[] = [];

  for (const f of files) {
    CLASS_HEAD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLASS_HEAD_RE.exec(f.source))) {
      const name = match[1];
      if (!name) continue;
      const body = sliceClassBody(f.source, match.index);
      if (!body) continue;
      if (!hasHttpCall(body)) continue;

      const symbols = collectStringFields(body);
      const calls = extractCalls(body, f.rel, name, symbols);
      if (!calls.length) continue;

      out.push({
        name,
        file: f.rel,
        feature: f.feature,
        calls,
      });
    }
  }

  out.sort((a, b) => a.feature.localeCompare(b.feature) || a.name.localeCompare(b.name));
  return out;
}

function hasHttpCall(body: string): boolean {
  HTTP_CALL_RE.lastIndex = 0;
  HTTP_REQUEST_RE.lastIndex = 0;
  return HTTP_CALL_RE.test(body) || HTTP_REQUEST_RE.test(body);
}

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

function collectStringFields(body: string): Map<string, string> {
  const out = new Map<string, string>();
  STRING_FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRING_FIELD_RE.exec(body))) {
    if (m[1] && m[3] != null) out.set(m[1], m[3]);
  }
  return out;
}

function extractCalls(body: string, file: string, enclosing: string, symbols: Map<string, string>): HttpCall[] {
  const out: HttpCall[] = [];
  const methodSpans = findMethodSpans(body);
  const findMethod = (idx: number): string => {
    for (const [start, end, name] of methodSpans) {
      if (idx >= start && idx <= end) return name;
    }
    return "";
  };

  HTTP_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTTP_CALL_RE.exec(body))) {
    if (!m[1] || m[3] == null) continue;
    const resolved = resolvePath(m[3], symbols);
    if (resolved) {
      out.push({
        method: m[1] as HttpMethod,
        path: resolved,
        file,
        enclosing,
        methodName: findMethod(m.index),
      });
    }
  }

  HTTP_REQUEST_RE.lastIndex = 0;
  while ((m = HTTP_REQUEST_RE.exec(body))) {
    if (!m[2] || m[4] == null) continue;
    const resolved = resolvePath(m[4], symbols);
    if (resolved) {
      out.push({
        method: m[2].toLowerCase() as HttpMethod,
        path: resolved,
        file,
        enclosing,
        methodName: findMethod(m.index),
      });
    }
  }

  return dedupeCalls(out);
}

/**
 * Find `[startIdx, endIdx, methodName]` spans for every Dart method declared
 * directly inside a class body. We rely on the convention that Dart method
 * declarations look like `<modifiers...> <ReturnType> name(<params>) <async?> {`
 * — we scan for that signature and balance the `{}` to find the end.
 */
function findMethodSpans(body: string): Array<[number, number, string]> {
  const re =
    /(?:Future(?:<[^>]+>)?\s+|Stream(?:<[^>]+>)?\s+|void\s+|[A-Z]\w*(?:<[^>]+>)?\??\s+)?(\w+)\s*\([^)]*\)\s*(?:async\s*\*?\s*)?\{/g;
  const spans: Array<[number, number, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const methodName = m[1];
    if (!methodName) continue;
    if (KEYWORDS.has(methodName)) continue;
    const openIdx = body.indexOf("{", m.index + m[0].length - 1);
    if (openIdx === -1) continue;
    const endIdx = matchBrace(body, openIdx);
    if (endIdx === -1) continue;
    spans.push([m.index, endIdx, methodName]);
  }
  return spans;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "do", "try", "catch"]);

function matchBrace(source: string, openIdx: number): number {
  if (source[openIdx] !== "{") return -1;
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = openIdx; i < source.length; i++) {
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
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Apply Dart string-interpolation substitution and produce a path that begins
 * with `/`. `baseUrl` always collapses to empty (the swagger paths we match
 * against don't include the host or prefix). Any unresolved variables collapse
 * to a `*` placeholder so the result still produces something matchable.
 */
function resolvePath(literal: string, symbols: Map<string, string>): string | null {
  let path = literal;

  // ${name} interpolation
  path = path.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    if (name === "baseUrl") return "";
    return symbols.get(name) ?? `{${name}}`;
  });
  // $name interpolation
  path = path.replace(/\$(\w+)/g, (_, name: string) => {
    if (name === "baseUrl") return "";
    return symbols.get(name) ?? `{${name}}`;
  });

  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return null;

  if (!path.startsWith("/")) path = `/${path}`;
  // Collapse double slashes from the baseUrl substitution.
  path = path.replace(/\/+/g, "/");

  return path;
}

function dedupeCalls(calls: HttpCall[]): HttpCall[] {
  const seen = new Set<string>();
  const out: HttpCall[] = [];
  for (const c of calls) {
    const key = `${c.method} ${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
