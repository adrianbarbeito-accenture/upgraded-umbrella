import type { CrossLinks, Endpoint, Flow, ParseResult } from "../types.ts";

/**
 * Group screens into "flows" indexed by the screen's feature folder. Each flow
 * carries the screen, its primary cubit (first matching name), the cubit's
 * primary repository, and the resolved Endpoint objects it consumes.
 *
 * A "flow" here is the unit a user reads in /flows/<name>.mdx — title page,
 * sequence diagram, prose. We pick one screen per flow to keep diagrams
 * focused; secondary screens for the same feature still get their own
 * /mobile/screens/<name>.mdx page.
 */
export function buildFlows(parsed: ParseResult, links: CrossLinks): Flow[] {
  const endpointById = new Map<string, Endpoint>();
  for (const ep of parsed.backend.endpoints) endpointById.set(ep.operationId, ep);

  const flows: Flow[] = [];

  for (const screen of parsed.flutter.screens) {
    const opIds = links.screenEndpoints[screen.name];
    if (!opIds?.length) continue;

    const cubit = parsed.flutter.cubits.find((c) => screen.cubits.includes(c.name));
    const repository = cubit
      ? parsed.flutter.repositories.find((r) => cubit.repositories.includes(r.name))
      : undefined;

    flows.push({
      key: flowKey(screen.feature, screen.name),
      title: humanizeScreen(screen.name),
      feature: screen.feature,
      screen,
      cubit,
      repository,
      endpoints: opIds
        .map((id) => endpointById.get(id))
        .filter((ep): ep is Endpoint => ep != null),
    });
  }

  flows.sort((a, b) => a.feature.localeCompare(b.feature) || a.key.localeCompare(b.key));
  return flows;
}

function flowKey(feature: string, screenName: string): string {
  return `${feature}-${kebab(screenName.replace(/(Screen|Page|View)$/, ""))}`;
}

function humanizeScreen(name: string): string {
  return name
    .replace(/(Screen|Page|View)$/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");
}
