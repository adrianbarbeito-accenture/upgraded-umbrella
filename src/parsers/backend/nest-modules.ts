import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { NestModule } from "../../types.ts";

export async function parseNestModules(repoDir: string): Promise<NestModule[]> {
  const project = new Project({
    tsConfigFilePath: path.join(repoDir, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  project.addSourceFilesAtPaths([
    path.join(repoDir, "src/**/*.ts"),
    `!${path.join(repoDir, "src/**/*.spec.ts")}`,
    `!${path.join(repoDir, "src/**/*.test.ts")}`,
  ]);

  const modules: NestModule[] = [];

  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      const moduleDecorator = cls.getDecorator("Module");
      if (!moduleDecorator) continue;
      const arg = moduleDecorator.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

      modules.push({
        name: cls.getName() ?? path.basename(sf.getFilePath()),
        file: path.relative(repoDir, sf.getFilePath()),
        imports: extractIdentList(arg, "imports"),
        controllers: extractIdentList(arg, "controllers"),
        providers: extractIdentList(arg, "providers"),
      });
    }
  }

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

function extractIdentList(arg: import("ts-morph").Node, propName: string): string[] {
  const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const prop = obj.getProperty(propName);
  if (!prop) return [];
  const init = prop.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) return [];
  const arr = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
  const out: string[] = [];
  for (const el of arr.getElements()) {
    const txt = el.getText().trim();
    // Strip dynamic .forRoot(...) / .register(...) calls down to the base identifier.
    const match = txt.match(/^([A-Za-z_$][\w$]*)/);
    if (match?.[1]) out.push(match[1]);
  }
  return out;
}
