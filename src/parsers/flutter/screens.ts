import type { FlutterScreen, WidgetNode } from "../../types.ts";
import type { DartFile } from "./walk.ts";

const SCREEN_CLASS_RE =
  /class\s+(\w+(?:Screen|Page|View))\s+extends\s+(?:Stateless|Stateful)Widget\b/g;

export function parseScreens(files: DartFile[]): FlutterScreen[] {
  const out: FlutterScreen[] = [];

  for (const f of files) {
    SCREEN_CLASS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCREEN_CLASS_RE.exec(f.source))) {
      const name = match[1];
      if (!name) continue;
      const widgetTree = extractWidgetTree(f.source, match.index);
      out.push({
        name,
        file: f.rel,
        feature: f.feature,
        widgetTree,
        cubits: extractCubitsReferenced(f.source),
      });
    }
  }

  out.sort((a, b) => a.feature.localeCompare(b.feature) || a.name.localeCompare(b.name));
  return out;
}

/**
 * Find the first Scaffold(...) instantiation after a class declaration and return
 * a coarse widget tree: top-level type + label-bearing direct children.
 *
 * The search extends to end-of-file rather than stopping at the class itself
 * because Flutter screens commonly delegate their Scaffold to a private inner
 * widget in the same file (e.g. `LoginScreen` returns
 * `BlocProvider(child: _LoginForm())`, with the Scaffold inside `_LoginForm`).
 *
 * Best-effort — a Dart AST would do better, but for wireframing the structural
 * skeleton is enough.
 */
function extractWidgetTree(source: string, classIdx: number): WidgetNode | null {
  const window = source.slice(classIdx);
  const scaffoldIdx = window.search(/\bScaffold\s*\(/);
  if (scaffoldIdx === -1) return null;

  const scaffoldArgs = sliceParens(window, scaffoldIdx + window.slice(scaffoldIdx).search(/\(/));
  if (!scaffoldArgs) return null;

  const root: WidgetNode = { type: "Scaffold", children: [] };

  const appBar = pickArg(scaffoldArgs, "appBar");
  if (appBar) {
    const title = appBar.match(/title:\s*(?:const\s+)?\w+\(\s*(['"])(.+?)\1/)?.[2];
    root.children.push({ type: "AppBar", text: title, children: [] });
  }

  const body = pickArg(scaffoldArgs, "body");
  if (body) {
    const bodyType = body.match(/^\s*(?:const\s+)?(\w+)\s*\(/)?.[1] ?? "Body";
    root.children.push({
      type: bodyType,
      children: collectImmediateChildren(body),
    });
  }

  const bottomNav = pickArg(scaffoldArgs, "bottomNavigationBar");
  if (bottomNav) {
    root.children.push({ type: "BottomNavigationBar", children: [] });
  }

  return root;
}

function extractCubitsReferenced(source: string): string[] {
  const seen = new Set<string>();
  for (const m of source.matchAll(/\b(\w+Cubit)\b/g)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen].sort();
}

/**
 * Given source[start] === '(', return the substring inside the matched parens
 * (excluding the outer parens themselves). String literals are skipped so
 * parens inside them don't unbalance the count.
 */
function sliceParens(source: string, openIdx: number): string | null {
  if (source[openIdx] !== "(") return null;
  let depth = 0;
  let i = openIdx;
  let inStr: '"' | "'" | null = null;
  for (; i < source.length; i++) {
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
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Best-effort: pick the value of a named argument inside a parens block.
 * Returns the raw substring up to the next sibling argument or end-of-block.
 */
function pickArg(args: string, name: string): string | null {
  const re = new RegExp(`(?:^|[\\s,({])${name}\\s*:\\s*`, "g");
  const m = re.exec(args);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk forward, balancing brackets, until we hit a top-level comma or end.
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = start; i < args.length; i++) {
    const ch = args[i];
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
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return args.slice(start, i).trim();
      depth--;
    } else if (ch === "," && depth === 0) {
      return args.slice(start, i).trim();
    }
  }
  return args.slice(start).trim();
}

/**
 * Within a body-arg substring, surface top-level Widget(...) constructors as
 * children. We only look at the first parenthesized block (the body's
 * constructor args) and pull out direct child constructors and Text(...).
 */
function collectImmediateChildren(body: string): WidgetNode[] {
  const open = body.indexOf("(");
  if (open === -1) return [];
  const inside = sliceParens(body, open);
  if (!inside) return [];

  // Look for `child:`, `children: [...]`, or just direct content.
  const children: WidgetNode[] = [];

  const childArg = pickArg(inside, "child");
  if (childArg) children.push(parseWidgetCall(childArg));

  const childrenArg = pickArg(inside, "children");
  if (childrenArg && childrenArg.startsWith("[")) {
    const list = sliceBrackets(childrenArg, 0);
    if (list) {
      for (const piece of splitTopLevelCommas(list)) {
        children.push(parseWidgetCall(piece));
      }
    }
  }

  // Texts that appear inline at this level (rare but useful).
  for (const m of inside.matchAll(/\bText\s*\(\s*(['"])(.+?)\1/g)) {
    if (m[2]) children.push({ type: "Text", text: m[2], children: [] });
  }

  return children.slice(0, 8); // cap noise
}

function parseWidgetCall(piece: string): WidgetNode {
  const trimmed = piece.trim().replace(/^const\s+/, "");
  const typeMatch = trimmed.match(/^(\w+)\s*\(/);
  const type = typeMatch?.[1] ?? "Widget";
  const text = trimmed.match(/\bText\s*\(\s*(['"])(.+?)\1/)?.[2];
  return { type, text, children: [] };
}

function sliceBrackets(source: string, openIdx: number): string | null {
  if (source[openIdx] !== "[") return null;
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
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

function splitTopLevelCommas(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
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
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      const piece = source.slice(start, i).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}
