import fs from "node:fs/promises";
import path from "node:path";
import {
  bulletList,
  endpointParametersTable,
  frontmatter,
  refToName,
  schemaPropertiesTable,
} from "../render/markdown.ts";
import {
  architectureDiagram,
  endpointMiniSequence,
  flowSequenceDiagram,
} from "../render/mermaid.ts";
import { renderWireframeSvg } from "../render/wireframe.ts";
import type { SynthClient } from "../synth/client.ts";
import type { AnalyzeResult, Endpoint, ParseResult, Schema } from "../types.ts";

export type WriteOptions = {
  outDir: string;
  parsed: ParseResult;
  analyzed: AnalyzeResult;
  synth: SynthClient;
  only?: "screens" | "endpoints" | "flows" | "architecture";
};

export async function writeMintlifyBundle(opts: WriteOptions): Promise<void> {
  const { outDir, parsed, analyzed, synth, only } = opts;
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  if (!only || only === "architecture") await writeArchitecture(outDir, parsed, synth);
  if (!only || only === "endpoints") await writeApi(outDir, parsed, analyzed, synth);
  if (!only || only === "screens") await writeMobile(outDir, parsed, analyzed, synth);
  if (!only || only === "flows") await writeFlows(outDir, analyzed, synth);

  await writeDataModel(outDir, parsed.backend.schemas);
  await writeIndex(outDir);
  await writeDocsJson(outDir, parsed, analyzed);
}

async function writeArchitecture(outDir: string, parsed: ParseResult, synth: SynthClient): Promise<void> {
  const dir = path.join(outDir, "architecture");
  await fs.mkdir(dir, { recursive: true });

  const overviewProse = await synth.architectureOverview();
  await fs.writeFile(
    path.join(dir, "overview.mdx"),
    [
      frontmatter({ title: "Architecture overview", description: "End-to-end shape of the Esmorga product." }),
      "## System diagram",
      "",
      architectureDiagram(parsed.backend.modules),
      "",
      "## Narrative",
      "",
      overviewProse,
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(dir, "backend.mdx"),
    [
      frontmatter({ title: "Backend", description: "NestJS modules, controllers, and providers." }),
      "## Modules",
      "",
      parsed.backend.modules.length
        ? parsed.backend.modules
            .map(
              (m) =>
                `### \`${m.name}\`\n\nFile: \`${m.file}\`\n\n**Imports:** ${listOrNone(m.imports)}\n\n**Controllers:** ${listOrNone(m.controllers)}\n\n**Providers:** ${listOrNone(m.providers)}\n`,
            )
            .join("\n")
        : "_No NestJS modules detected — verify `tsconfig.json` exists in the backend repo._",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(dir, "mobile.mdx"),
    [
      frontmatter({ title: "Mobile", description: "Flutter app structure: features, cubits, repositories." }),
      `Package **${parsed.flutter.pubspec.name}** v${parsed.flutter.pubspec.version}.`,
      "",
      `Top dependencies: ${parsed.flutter.pubspec.dependencies.slice(0, 20).map((d) => `\`${d}\``).join(", ") || "_(none detected)_"}.`,
      "",
      "## Features",
      "",
      featureBreakdown(parsed),
      "",
    ].join("\n"),
  );
}

async function writeApi(
  outDir: string,
  parsed: ParseResult,
  analyzed: AnalyzeResult,
  synth: SynthClient,
): Promise<void> {
  const apiDir = path.join(outDir, "api");
  await fs.mkdir(apiDir, { recursive: true });

  const schemaByName = new Map<string, Schema>(parsed.backend.schemas.map((s) => [s.name, s]));

  for (const ep of parsed.backend.endpoints) {
    const tagDir = path.join(apiDir, slug(ep.tag));
    await fs.mkdir(tagDir, { recursive: true });

    const consumers = analyzed.crossLinks.endpointConsumers[ep.operationId] ?? [];
    const prose = await synth.endpointProse(ep, consumers);

    const reqSchemaName = refToName(ep.requestBodySchemaRef);
    const reqSchema = reqSchemaName ? schemaByName.get(reqSchemaName) : null;

    const sections: string[] = [
      frontmatter({
        title: `${ep.method.toUpperCase()} ${ep.path}`,
        description: ep.summary || ep.operationId,
      }),
      `**Tag:** \`${ep.tag}\` &nbsp;·&nbsp; **Operation:** \`${ep.operationId}\``,
      "",
      "## Purpose",
      "",
      prose,
      "",
      "## Sequence",
      "",
      endpointMiniSequence(ep, consumers),
      "",
    ];

    if (ep.parameters.length) {
      sections.push("## Parameters", "", endpointParametersTable(ep), "");
    }
    if (reqSchema) {
      sections.push(
        "## Request body",
        "",
        `Schema: [\`${reqSchema.name}\`](/data-model/${slug(reqSchema.name)})`,
        "",
        schemaPropertiesTable(reqSchema),
        "",
      );
    }
    if (ep.responses.length) {
      sections.push(
        "## Responses",
        "",
        ep.responses
          .map((r) => {
            const schemaName = refToName(r.schemaRef);
            const schemaLink = schemaName
              ? ` — [\`${schemaName}\`](/data-model/${slug(schemaName)})`
              : "";
            return `- **${r.status}** — ${r.description || "_(no description)_"}${schemaLink}`;
          })
          .join("\n"),
        "",
      );
    }
    sections.push("## Used by", "", consumers.length ? consumers.map((c) => `- [\`${c}\`](/mobile/screens/${slug(c)})`).join("\n") : "_(no mobile screens detected calling this endpoint)_", "");

    await fs.writeFile(path.join(tagDir, `${slug(ep.operationId)}.mdx`), sections.join("\n"));
  }
}

async function writeMobile(
  outDir: string,
  parsed: ParseResult,
  analyzed: AnalyzeResult,
  synth: SynthClient,
): Promise<void> {
  const screensDir = path.join(outDir, "mobile", "screens");
  const stateDir = path.join(outDir, "mobile", "state");
  await fs.mkdir(screensDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  const endpointById = new Map<string, Endpoint>();
  for (const ep of parsed.backend.endpoints) endpointById.set(ep.operationId, ep);

  for (const screen of parsed.flutter.screens) {
    const opIds = analyzed.crossLinks.screenEndpoints[screen.name] ?? [];
    const endpoints = opIds.map((id) => endpointById.get(id)).filter((e): e is Endpoint => e != null);
    const prose = await synth.screenProse(screen, endpoints);

    const sections: string[] = [
      frontmatter({
        title: screen.name,
        description: `Mobile screen in the \`${screen.feature}\` feature.`,
      }),
      "## Wireframe",
      "",
      renderWireframeSvg(screen.widgetTree, screen.name),
      "",
      "## Purpose",
      "",
      prose,
      "",
      "## Source",
      "",
      `\`${screen.file}\``,
      "",
      "## State (cubits)",
      "",
      bulletList(screen.cubits.map((c) => `[\`${c}\`](/mobile/state/${slug(c)})`)),
      "",
      "## Endpoints called",
      "",
      endpoints.length
        ? endpoints
            .map(
              (ep) =>
                `- [\`${ep.method.toUpperCase()} ${ep.path}\`](/api/${slug(ep.tag)}/${slug(ep.operationId)})`,
            )
            .join("\n")
        : "_(none detected)_",
      "",
    ];
    await fs.writeFile(path.join(screensDir, `${slug(screen.name)}.mdx`), sections.join("\n"));
  }

  for (const cubit of parsed.flutter.cubits) {
    const sections: string[] = [
      frontmatter({
        title: cubit.name,
        description: `Cubit in the \`${cubit.feature}\` feature.`,
      }),
      `**Source:** \`${cubit.file}\``,
      "",
      "## States",
      "",
      bulletList(cubit.states.map((s) => `\`${s}\``)),
      "",
      "## Emits",
      "",
      bulletList(cubit.emits.map((s) => `\`${s}\``)),
      "",
      "## Repositories",
      "",
      bulletList(cubit.repositories.map((r) => `\`${r}\``)),
      "",
    ];
    await fs.writeFile(path.join(stateDir, `${slug(cubit.name)}.mdx`), sections.join("\n"));
  }
}

async function writeFlows(outDir: string, analyzed: AnalyzeResult, synth: SynthClient): Promise<void> {
  const dir = path.join(outDir, "flows");
  await fs.mkdir(dir, { recursive: true });

  for (const flow of analyzed.flows) {
    const prose = await synth.flowProse(flow);

    const sections: string[] = [
      frontmatter({ title: flow.title, description: `User flow in the \`${flow.feature}\` feature.` }),
      "## Sequence",
      "",
      flowSequenceDiagram(flow),
      "",
      "## Narrative",
      "",
      prose,
      "",
      "## Components",
      "",
      `- Screen: ${flow.screen ? `[\`${flow.screen.name}\`](/mobile/screens/${slug(flow.screen.name)})` : "_unknown_"}`,
      `- Cubit: ${flow.cubit ? `[\`${flow.cubit.name}\`](/mobile/state/${slug(flow.cubit.name)})` : "_unknown_"}`,
      `- Repository: ${flow.repository ? `\`${flow.repository.name}\`` : "_unknown_"}`,
      "",
      "## Endpoints",
      "",
      flow.endpoints.length
        ? flow.endpoints
            .map(
              (ep) =>
                `- [\`${ep.method.toUpperCase()} ${ep.path}\`](/api/${slug(ep.tag)}/${slug(ep.operationId)})`,
            )
            .join("\n")
        : "_(none)_",
      "",
    ];
    await fs.writeFile(path.join(dir, `${slug(flow.key)}.mdx`), sections.join("\n"));
  }
}

async function writeDataModel(outDir: string, schemas: Schema[]): Promise<void> {
  const dir = path.join(outDir, "data-model");
  await fs.mkdir(dir, { recursive: true });
  for (const schema of schemas) {
    const sections: string[] = [
      frontmatter({ title: schema.name, description: schema.description || `Data model: ${schema.name}.` }),
      "## Properties",
      "",
      schemaPropertiesTable(schema),
      "",
    ];
    await fs.writeFile(path.join(dir, `${slug(schema.name)}.mdx`), sections.join("\n"));
  }
}

async function writeIndex(outDir: string): Promise<void> {
  await fs.writeFile(
    path.join(outDir, "index.mdx"),
    [
      frontmatter({ title: "Esmorga", description: "Auto-generated functional documentation." }),
      "Welcome. This documentation is regenerated from the [Flutter app](https://github.com/cmm-apps-flutter/EsmorgaFlutter) and [backend](https://github.com/Esmorga-Backend/esmorga-backend) source repos.",
      "",
      "Start with the [architecture overview](/architecture/overview), then drill into the [user flows](/flows), the [API surface](/api), or the [mobile screens](/mobile/screens).",
      "",
    ].join("\n"),
  );
}

async function writeDocsJson(outDir: string, parsed: ParseResult, analyzed: AnalyzeResult): Promise<void> {
  const screenPages = parsed.flutter.screens.map((s) => `mobile/screens/${slug(s.name)}`).sort();
  const cubitPages = parsed.flutter.cubits.map((c) => `mobile/state/${slug(c.name)}`).sort();
  const flowPages = analyzed.flows.map((f) => `flows/${slug(f.key)}`).sort();
  const schemaPages = parsed.backend.schemas.map((s) => `data-model/${slug(s.name)}`).sort();

  const apiPagesByTag = new Map<string, string[]>();
  for (const ep of parsed.backend.endpoints) {
    const list = apiPagesByTag.get(ep.tag) ?? [];
    list.push(`api/${slug(ep.tag)}/${slug(ep.operationId)}`);
    apiPagesByTag.set(ep.tag, list);
  }
  const apiGroups = [...apiPagesByTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, pages]) => ({ group: humanize(tag), pages: pages.sort() }));

  const docsJson = {
    $schema: "https://mintlify.com/docs.json",
    name: "Esmorga",
    theme: "mint",
    colors: { primary: "#0EA5E9", light: "#38BDF8", dark: "#0369A1" },
    navigation: {
      tabs: [
        {
          tab: "Documentation",
          groups: [
            { group: "Overview", pages: ["index"] },
            {
              group: "Architecture",
              pages: ["architecture/overview", "architecture/backend", "architecture/mobile"],
            },
            { group: "User flows", pages: flowPages },
            { group: "Mobile screens", pages: screenPages },
            { group: "Mobile state", pages: cubitPages },
            { group: "Data model", pages: schemaPages },
            { group: "API", groups: apiGroups },
          ],
        },
      ],
    },
  };
  await fs.writeFile(path.join(outDir, "docs.json"), JSON.stringify(docsJson, null, 2));
}

function listOrNone(items: string[]): string {
  return items.length ? items.map((i) => `\`${i}\``).join(", ") : "_(none)_";
}

function featureBreakdown(parsed: ParseResult): string {
  const features = new Map<string, { screens: string[]; cubits: string[]; repositories: string[] }>();
  const ensure = (key: string) => {
    if (!features.has(key)) features.set(key, { screens: [], cubits: [], repositories: [] });
    return features.get(key)!;
  };
  for (const s of parsed.flutter.screens) ensure(s.feature).screens.push(s.name);
  for (const c of parsed.flutter.cubits) ensure(c.feature).cubits.push(c.name);
  for (const r of parsed.flutter.repositories) ensure(r.feature).repositories.push(r.name);

  if (!features.size) return "_(no features detected)_";

  return [...features.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([feat, data]) =>
        `### \`${feat}\`\n\n- Screens: ${data.screens.length ? data.screens.map((n) => `\`${n}\``).join(", ") : "_(none)_"}\n- Cubits: ${data.cubits.length ? data.cubits.map((n) => `\`${n}\``).join(", ") : "_(none)_"}\n- Repositories: ${data.repositories.length ? data.repositories.map((n) => `\`${n}\``).join(", ") : "_(none)_"}\n`,
    )
    .join("\n");
}

function slug(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");
}

function humanize(s: string): string {
  return s.replace(/-_/g, " ").replace(/(?:^|\s)\w/g, (c) => c.toUpperCase());
}
