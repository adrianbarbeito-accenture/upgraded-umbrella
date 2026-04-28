import "dotenv/config";
import { Command } from "commander";
import { DOCS_OUT_DIR, SOURCES } from "./config.ts";
import { cloneOrPull } from "./fetch/git-clone.ts";
import { parseNestModules } from "./parsers/backend/nest-modules.ts";
import { parseSwagger } from "./parsers/backend/swagger.ts";
import { parseClassRefs } from "./parsers/flutter/class-refs.ts";
import { parseCubits } from "./parsers/flutter/cubits.ts";
import { parsePubspec } from "./parsers/flutter/pubspec.ts";
import { parseRepositories } from "./parsers/flutter/repositories.ts";
import { parseRoutes } from "./parsers/flutter/routes.ts";
import { parseScreens } from "./parsers/flutter/screens.ts";
import { walkDartFiles } from "./parsers/flutter/walk.ts";
import { linkCrossRepo } from "./analyze/cross-repo.ts";
import { buildFlows } from "./analyze/flows.ts";
import { SynthClient } from "./synth/client.ts";
import { writeMintlifyBundle } from "./output/mintlify.ts";
import type { ParseResult } from "./types.ts";

type CliOptions = {
  noSynth?: boolean;
  refFlutter?: string;
  refBackend?: string;
  only?: "screens" | "endpoints" | "flows" | "architecture";
};

async function main(): Promise<void> {
  const program = new Command()
    .name("generate")
    .description("Generate Mintlify-ready docs from Esmorga's Flutter + backend repos.")
    .option("--no-synth", "Skip Claude prose synthesis. Emit TODO placeholders instead.")
    .option("--ref-flutter <ref>", "Git ref for the Flutter repo", SOURCES.flutter.defaultRef)
    .option("--ref-backend <ref>", "Git ref for the backend repo", SOURCES.backend.defaultRef)
    .option("--only <section>", "Regenerate only one section: screens|endpoints|flows|architecture")
    .parse(process.argv);

  const opts = program.opts<CliOptions>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const synthEnabled = opts.noSynth !== true && !!apiKey;

  log("Esmorga docs generator");
  log(`  synth: ${synthEnabled ? "ON (Claude)" : "OFF (TODO placeholders)"}`);
  log(`  flutter ref: ${opts.refFlutter ?? SOURCES.flutter.defaultRef}`);
  log(`  backend ref: ${opts.refBackend ?? SOURCES.backend.defaultRef}`);

  log("\n[fetch] cloning/pulling source repos…");
  const [flutter, backend] = await Promise.all([
    cloneOrPull(SOURCES.flutter, opts.refFlutter ?? SOURCES.flutter.defaultRef),
    cloneOrPull(SOURCES.backend, opts.refBackend ?? SOURCES.backend.defaultRef),
  ]);
  log(`  flutter @ ${flutter.sha.slice(0, 7)}`);
  log(`  backend @ ${backend.sha.slice(0, 7)}`);

  log("\n[parse] backend…");
  const [{ endpoints, schemas }, modules] = await Promise.all([
    parseSwagger(SOURCES.backend.cacheDir),
    safeParseNestModules(SOURCES.backend.cacheDir),
  ]);
  log(`  ${endpoints.length} endpoints, ${schemas.length} schemas, ${modules.length} modules`);

  log("[parse] flutter…");
  const dartFiles = await walkDartFiles(SOURCES.flutter.cacheDir);
  const pubspec = await parsePubspec(SOURCES.flutter.cacheDir);
  const screens = parseScreens(dartFiles);
  const cubits = parseCubits(dartFiles);
  const repositories = parseRepositories(dartFiles);
  const routes = parseRoutes(dartFiles);
  const classRefs = parseClassRefs(dartFiles);
  log(
    `  ${screens.length} screens, ${cubits.length} cubits, ${repositories.length} HTTP-call sites, ${routes.length} routes, ${Object.keys(classRefs).length} classes mapped`,
  );

  const parsed: ParseResult = {
    backend: { endpoints, schemas, modules },
    flutter: { pubspec, routes, screens, cubits, repositories, classRefs },
  };

  log("\n[analyze] cross-repo linking + flows…");
  const crossLinks = linkCrossRepo(parsed);
  const flows = buildFlows(parsed, crossLinks);
  log(
    `  ${Object.keys(crossLinks.screenEndpoints).length} screens linked, ${Object.keys(crossLinks.endpointConsumers).length} endpoints consumed, ${flows.length} flows`,
  );

  log("\n[synth + render] writing docs…");
  const synth = new SynthClient({ enabled: synthEnabled, apiKey, parsed });
  await writeMintlifyBundle({
    outDir: DOCS_OUT_DIR,
    parsed,
    analyzed: { flows, crossLinks },
    synth,
    only: opts.only,
  });

  log(`\n✓ Wrote docs to ${DOCS_OUT_DIR}`);
  if (!synthEnabled) {
    log("  (Prose blocks contain TODO placeholders. Set ANTHROPIC_API_KEY and re-run without --no-synth to fill them.)");
  }
}

async function safeParseNestModules(repoDir: string): Promise<ReturnType<typeof parseNestModules> extends Promise<infer T> ? T : never> {
  try {
    return await parseNestModules(repoDir);
  } catch (err) {
    log(`  warning: NestJS module graph failed (${(err as Error).message}); continuing without it.`);
    return [];
  }
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

main().catch((err) => {
  console.error("\n✗ generate failed:", err);
  process.exit(1);
});
