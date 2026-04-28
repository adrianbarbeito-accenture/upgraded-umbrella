import type { Endpoint, Schema } from "../types.ts";

export function frontmatter(fields: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${escapeYaml(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function endpointParametersTable(ep: Endpoint): string {
  if (!ep.parameters.length) return "";
  const rows = [
    "| Name | In | Required | Type | Description |",
    "| ---- | -- | -------- | ---- | ----------- |",
    ...ep.parameters.map(
      (p) =>
        `| \`${p.name}\` | ${p.in} | ${p.required ? "yes" : "no"} | \`${p.type}\` | ${cellEscape(p.description)} |`,
    ),
  ];
  return rows.join("\n");
}

export function schemaPropertiesTable(schema: Schema): string {
  if (!schema.properties.length) return "_(no properties)_";
  const rows = [
    "| Property | Type | Required | Description |",
    "| -------- | ---- | -------- | ----------- |",
    ...schema.properties.map(
      (p) =>
        `| \`${p.name}\` | \`${p.type}\` | ${p.required ? "yes" : "no"} | ${cellEscape(p.description)} |`,
    ),
  ];
  return rows.join("\n");
}

export function bulletList(items: string[]): string {
  return items.length ? items.map((s) => `- ${s}`).join("\n") : "_(none)_";
}

export function refToName(ref: string | undefined): string | null {
  if (!ref) return null;
  return ref.split("/").pop() ?? null;
}

function escapeYaml(s: string): string {
  if (/^[\w\s\-./()]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function cellEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
