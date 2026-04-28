import Anthropic from "@anthropic-ai/sdk";
import type { Endpoint, Flow, FlutterScreen, ParseResult } from "../types.ts";

const PROSE_MODEL = "claude-haiku-4-5";
const ARCHITECTURE_MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You write functional documentation for a software product.

Voice & rules:
- Plain English, present tense, third person.
- One paragraph (3–5 sentences) unless told otherwise.
- No headings, no bullet lists, no code fences. Just prose.
- Describe what the thing is for from the user's perspective. Avoid restating obvious type signatures or the names already shown in the surrounding markdown.
- Never invent product behavior that isn't supported by the structural data given.
- If you genuinely cannot infer a purpose, output a single sentence describing what is known and explicitly note that intent is unclear.`;

export type SynthOptions = {
  enabled: boolean;
  apiKey?: string;
  parsed: ParseResult;
};

/**
 * Wraps Anthropic SDK calls. The system prompt + a structural digest of both
 * repos is sent as a cached prefix, so per-page calls only pay for the small
 * per-item user message.
 *
 * When `enabled` is false (CLI run with --no-synth or missing API key), every
 * method returns a TODO placeholder so the rest of the pipeline still runs.
 */
export class SynthClient {
  private readonly client: Anthropic | null;
  private readonly enabled: boolean;
  private readonly digest: string;

  constructor(opts: SynthOptions) {
    this.enabled = opts.enabled && !!opts.apiKey;
    this.client = this.enabled ? new Anthropic({ apiKey: opts.apiKey }) : null;
    this.digest = buildDigest(opts.parsed);
  }

  async screenProse(screen: FlutterScreen, endpoints: Endpoint[]): Promise<string> {
    if (!this.enabled || !this.client) return todoStub("screen prose");
    const calls = endpoints.length
      ? endpoints.map((e) => `${e.method.toUpperCase()} ${e.path}`).join(", ")
      : "no API calls";
    const userMsg = `Describe the purpose of the mobile screen \`${screen.name}\` (feature: ${screen.feature}, file: ${screen.file}). It uses cubits: ${screen.cubits.join(", ") || "none"}. It triggers: ${calls}.`;
    return this.callProse(userMsg);
  }

  async endpointProse(ep: Endpoint, consumers: string[]): Promise<string> {
    if (!this.enabled || !this.client) return todoStub("endpoint prose");
    const userMsg = `Describe the purpose of the API endpoint \`${ep.method.toUpperCase()} ${ep.path}\` (operationId \`${ep.operationId}\`, tag ${ep.tag}). Swagger summary: ${ep.summary || "(none)"}. Mobile screens that call it: ${consumers.length ? consumers.join(", ") : "none"}.`;
    return this.callProse(userMsg);
  }

  async flowProse(flow: Flow): Promise<string> {
    if (!this.enabled || !this.client) return todoStub("flow prose");
    const eps = flow.endpoints.map((e) => `${e.method.toUpperCase()} ${e.path}`).join(", ") || "none";
    const userMsg = `Narrate the user flow "${flow.title}" (feature: ${flow.feature}). Screen: ${flow.screen?.name ?? "unknown"}. Cubit: ${flow.cubit?.name ?? "unknown"}. Repository: ${flow.repository?.name ?? "unknown"}. Endpoints involved: ${eps}. Two short paragraphs: (1) what triggers the flow and what the user sees, (2) what the system does end-to-end.`;
    return this.callProse(userMsg);
  }

  async architectureOverview(): Promise<string> {
    if (!this.enabled || !this.client) return todoStub("architecture overview");
    const userMsg = `Write a 4–6 paragraph architecture overview of this product. Use the digest above as your only source of truth. Cover: high-level shape (mobile + backend + database), how mobile state is organized (Cubit pattern), how mobile reaches the backend (repository → swagger-defined REST), how the backend is organized into modules, and any cross-cutting concerns visible in the digest. Markdown formatting allowed (paragraphs and inline code only — no headings, no lists).`;
    const resp = await this.client!.messages.create({
      model: ARCHITECTURE_MODEL,
      max_tokens: 1500,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: this.digest, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMsg }],
    });
    return extractText(resp);
  }

  private async callProse(userMsg: string): Promise<string> {
    const resp = await this.client!.messages.create({
      model: PROSE_MODEL,
      max_tokens: 400,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: this.digest, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMsg }],
    });
    return extractText(resp);
  }
}

function extractText(resp: Anthropic.Messages.Message): string {
  const blocks = resp.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  return blocks.map((b) => b.text).join("\n").trim();
}

function todoStub(kind: string): string {
  return `> TODO (${kind}): run \`npm run generate\` with \`ANTHROPIC_API_KEY\` set to fill this in.`;
}

/**
 * Compact structural digest used as the cached system context. Keep it under
 * ~6KB so the cache prefix is cheap; favor names and counts over exhaustive detail.
 */
function buildDigest(parsed: ParseResult): string {
  const lines: string[] = [];
  lines.push("# Repo digest (cached context)");
  lines.push("");
  lines.push("## Mobile (Flutter, Cubit/BLoC)");
  lines.push(`Package: ${parsed.flutter.pubspec.name} v${parsed.flutter.pubspec.version}`);
  lines.push(`Top dependencies: ${parsed.flutter.pubspec.dependencies.slice(0, 20).join(", ")}`);
  lines.push("");
  lines.push("Screens:");
  for (const s of parsed.flutter.screens) {
    lines.push(`- ${s.name} [${s.feature}] cubits=${s.cubits.join("|") || "-"}`);
  }
  lines.push("");
  lines.push("Cubits:");
  for (const c of parsed.flutter.cubits) {
    lines.push(`- ${c.name} [${c.feature}] states=${c.states.join("|")} repos=${c.repositories.join("|")}`);
  }
  lines.push("");
  lines.push("Repositories & calls:");
  for (const r of parsed.flutter.repositories) {
    lines.push(`- ${r.name} [${r.feature}]`);
    for (const call of r.calls) {
      lines.push(`    ${call.method.toUpperCase()} ${call.path}`);
    }
  }
  lines.push("");
  lines.push("## Backend (NestJS + MongoDB)");
  lines.push("Modules:");
  for (const m of parsed.backend.modules) {
    lines.push(`- ${m.name} controllers=${m.controllers.join("|")} providers=${m.providers.join("|")}`);
  }
  lines.push("");
  lines.push("Endpoints:");
  for (const e of parsed.backend.endpoints) {
    lines.push(`- ${e.method.toUpperCase()} ${e.path} [${e.tag}] ${e.operationId} :: ${e.summary}`);
  }
  return lines.join("\n");
}
