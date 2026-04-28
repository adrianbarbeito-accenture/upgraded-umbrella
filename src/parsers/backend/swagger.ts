import fs from "node:fs/promises";
import path from "node:path";
import type { Endpoint, HttpMethod, Schema } from "../../types.ts";

const SWAGGER_CANDIDATES = ["swagger.json", "openapi.json", "docs/swagger.json"];

type OpenApiDoc = {
  paths?: Record<string, Record<string, OpenApiOp>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
};

type OpenApiOp = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: { type?: string; $ref?: string };
  }>;
  requestBody?: {
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }
  >;
};

type OpenApiSchema = {
  description?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string; $ref?: string }>;
};

const HTTP_METHODS: ReadonlySet<HttpMethod> = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

export async function parseSwagger(repoDir: string): Promise<{
  endpoints: Endpoint[];
  schemas: Schema[];
}> {
  const file = await findSwaggerFile(repoDir);
  if (!file) {
    return { endpoints: [], schemas: [] };
  }
  const raw = await fs.readFile(file, "utf8");
  const doc = JSON.parse(raw) as OpenApiDoc;

  const endpoints: Endpoint[] = [];
  for (const [pathKey, byMethod] of Object.entries(doc.paths ?? {})) {
    for (const [methodKey, op] of Object.entries(byMethod)) {
      if (!HTTP_METHODS.has(methodKey as HttpMethod)) continue;
      const method = methodKey as HttpMethod;
      const operationId =
        op.operationId ?? `${method}_${pathKey.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
      endpoints.push({
        operationId,
        method,
        path: pathKey,
        tag: op.tags?.[0] ?? "default",
        summary: op.summary ?? "",
        description: op.description ?? "",
        parameters: (op.parameters ?? []).map((p) => ({
          name: p.name,
          in: (p.in as Endpoint["parameters"][number]["in"]) ?? "query",
          required: !!p.required,
          type: p.schema?.type ?? p.schema?.$ref?.split("/").pop() ?? "string",
          description: p.description ?? "",
        })),
        requestBodySchemaRef: op.requestBody?.content?.["application/json"]?.schema?.$ref,
        responses: Object.entries(op.responses ?? {}).map(([status, r]) => ({
          status,
          description: r.description ?? "",
          schemaRef: r.content?.["application/json"]?.schema?.$ref,
        })),
      });
    }
  }

  const schemas: Schema[] = Object.entries(doc.components?.schemas ?? {}).map(([name, s]) => ({
    name,
    ref: `#/components/schemas/${name}`,
    description: s.description ?? "",
    properties: Object.entries(s.properties ?? {}).map(([propName, prop]) => ({
      name: propName,
      type: prop.type ?? prop.$ref?.split("/").pop() ?? "string",
      required: (s.required ?? []).includes(propName),
      description: prop.description ?? "",
    })),
  }));

  endpoints.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path));
  return { endpoints, schemas };
}

async function findSwaggerFile(repoDir: string): Promise<string | null> {
  for (const candidate of SWAGGER_CANDIDATES) {
    const full = path.join(repoDir, candidate);
    const ok = await fs
      .stat(full)
      .then(() => true)
      .catch(() => false);
    if (ok) return full;
  }
  return null;
}
