import type { FlutterRoute } from "../../types.ts";
import type { DartFile } from "./walk.ts";

/**
 * Recognizes go_router's `GoRoute(path: '/x', name: 'x', builder: (ctx, st) => XScreen(...))`.
 * Falls back to capturing the screen name from the builder return.
 */
const GO_ROUTE_RE =
  /GoRoute\s*\(\s*([\s\S]*?)\)/g;

export function parseRoutes(files: DartFile[]): FlutterRoute[] {
  const out: FlutterRoute[] = [];

  for (const f of files) {
    if (!f.source.includes("GoRoute")) continue;
    GO_ROUTE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GO_ROUTE_RE.exec(f.source))) {
      const args = match[1] ?? "";
      const path = args.match(/path:\s*(['"])(.+?)\1/)?.[2];
      if (!path) continue;
      const name = args.match(/name:\s*(['"])(.+?)\1/)?.[2];
      const screen = args.match(/=>\s*(?:const\s+)?(\w+(?:Screen|Page|View))/)?.[1];
      out.push({
        name: name ?? path,
        path,
        screen: screen ?? "",
      });
    }
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
