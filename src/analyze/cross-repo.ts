import type { CrossLinks, Endpoint, ParseResult } from "../types.ts";

/**
 * For each Flutter screen, walk Screen → Cubit → (transitive class refs) →
 * any class that issues HTTP calls, then match each call to a swagger
 * operation. Produces both directions of the cross-link.
 *
 * Path normalization rules (applied to both Flutter call paths and swagger
 * paths before comparison):
 *  - Strip leading `/api`, `/v1`, `/v\d+` prefixes when present on either side.
 *  - Replace `{x}` and `:x` placeholders with `*`.
 *  - Trim trailing slashes.
 */
export function linkCrossRepo(parsed: ParseResult): CrossLinks {
  const endpointsByKey = new Map<string, Endpoint>();
  for (const ep of parsed.backend.endpoints) {
    endpointsByKey.set(makeKey(ep.method, ep.path), ep);
  }

  // Class name -> list of (methodName, operationId) pairs.
  type Indexed = { methodName: string; operationId: string };
  const callSiteOps = new Map<string, Indexed[]>();
  for (const repo of parsed.flutter.repositories) {
    const indexed: Indexed[] = [];
    for (const call of repo.calls) {
      const op = endpointsByKey.get(makeKey(call.method, call.path));
      if (op) indexed.push({ methodName: call.methodName, operationId: op.operationId });
    }
    if (indexed.length) callSiteOps.set(repo.name, indexed);
  }

  const endpointConsumers: Record<string, string[]> = {};
  const screenEndpoints: Record<string, string[]> = {};

  // For each cubit, BFS through classRefs to find all reachable HTTP-call
  // methods, then keep only those whose method name the cubit actually
  // invokes. This drops the false positives where a transitively-reachable
  // class hosts unrelated endpoints.
  const cubitOps = new Map<string, string[]>();
  for (const cubit of parsed.flutter.cubits) {
    const invoked = new Set(cubit.invokes);
    const reached = reachableOps(
      [cubit.name, ...cubit.repositories],
      parsed.flutter.classRefs,
      callSiteOps,
    );
    const filtered = reached.filter((entry) => !entry.methodName || invoked.has(entry.methodName));
    const ops = [...new Set(filtered.map((e) => e.operationId))].sort();
    if (ops.length) cubitOps.set(cubit.name, ops);
  }

  // Screen → Cubit → ops.
  for (const screen of parsed.flutter.screens) {
    const ops = new Set<string>();
    for (const cubitName of screen.cubits) {
      for (const op of cubitOps.get(cubitName) ?? []) ops.add(op);
    }
    if (!ops.size) continue;
    screenEndpoints[screen.name] = [...ops].sort();
    for (const op of ops) {
      (endpointConsumers[op] ??= []).push(screen.name);
    }
  }

  for (const op of Object.keys(endpointConsumers)) {
    endpointConsumers[op] = [...new Set(endpointConsumers[op])].sort();
  }

  return { endpointConsumers, screenEndpoints };
}

type Indexed = { methodName: string; operationId: string };

function reachableOps(
  seeds: string[],
  classRefs: Record<string, string[]>,
  callSiteOps: Map<string, Indexed[]>,
): Indexed[] {
  const visited = new Set<string>();
  const queue: string[] = [...seeds];
  const out: Indexed[] = [];
  const MAX_NODES = 200;

  while (queue.length && visited.size < MAX_NODES) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);

    const direct = callSiteOps.get(next);
    if (direct) out.push(...direct);

    for (const ref of classRefs[next] ?? []) {
      if (!visited.has(ref)) queue.push(ref);
    }
  }
  return out;
}

function makeKey(method: string, path: string): string {
  return `${method.toLowerCase()} ${normalizeSegments(path).join("/")}`;
}

function normalizeSegments(input: string): string[] {
  const cleaned = input.replace(/\$\{(\w+)\}/g, "{$1}").replace(/:(\w+)/g, "{$1}");
  return cleaned
    .split("/")
    .filter(Boolean)
    .filter((seg, i) => !(i === 0 && /^(api|v\d+)$/.test(seg)))
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? "*" : seg));
}
