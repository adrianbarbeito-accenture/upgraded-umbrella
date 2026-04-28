import type { Endpoint, Flow, NestModule } from "../types.ts";

export function flowSequenceDiagram(flow: Flow): string {
  const screen = flow.screen?.name ?? "Screen";
  const cubit = flow.cubit?.name ?? "Cubit";
  const repo = flow.repository?.name ?? "Repository";

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("sequenceDiagram");
  lines.push(`  participant U as User`);
  lines.push(`  participant S as ${screen}`);
  lines.push(`  participant C as ${cubit}`);
  lines.push(`  participant R as ${repo}`);
  lines.push(`  participant API as Backend`);
  lines.push(`  participant DB as MongoDB`);
  lines.push(``);
  lines.push(`  U->>S: interact`);
  lines.push(`  S->>C: dispatch`);
  lines.push(`  C->>R: call method`);
  for (const ep of flow.endpoints) {
    lines.push(`  R->>API: ${ep.method.toUpperCase()} ${ep.path}`);
    lines.push(`  API->>DB: query`);
    lines.push(`  DB-->>API: result`);
    lines.push(`  API-->>R: ${ep.responses[0]?.status ?? "200"} response`);
  }
  lines.push(`  R-->>C: data`);
  lines.push(`  C-->>S: emit state`);
  lines.push(`  S-->>U: render`);
  lines.push("```");
  return lines.join("\n");
}

export function architectureDiagram(modules: NestModule[]): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push("  subgraph Mobile");
  lines.push("    UI[Screens] --> CUBIT[Cubits]");
  lines.push("    CUBIT --> REPO[Repositories]");
  lines.push("  end");
  lines.push("  subgraph Backend");
  for (const m of modules.slice(0, 12)) {
    lines.push(`    ${safe(m.name)}[${m.name}]`);
  }
  lines.push("  end");
  lines.push("  REPO -->|HTTPS| Backend");
  lines.push("  Backend -->|Mongoose| MONGO[(MongoDB)]");
  lines.push("```");
  return lines.join("\n");
}

export function endpointMiniSequence(ep: Endpoint, consumers: string[]): string {
  const consumer = consumers[0] ?? "Client";
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("sequenceDiagram");
  lines.push(`  participant C as ${consumer}`);
  lines.push(`  participant API as Backend`);
  lines.push(`  participant DB as MongoDB`);
  lines.push(`  C->>API: ${ep.method.toUpperCase()} ${ep.path}`);
  lines.push(`  API->>DB: query`);
  lines.push(`  DB-->>API: result`);
  lines.push(`  API-->>C: ${ep.responses[0]?.status ?? "200"}`);
  lines.push("```");
  return lines.join("\n");
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}
