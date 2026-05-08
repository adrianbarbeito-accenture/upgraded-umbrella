# Esmorga docs

Auto-generates Mintlify-ready Markdown for the Esmorga product from its two source repos:

- Mobile: [`cmm-apps-flutter/EsmorgaFlutter`](https://github.com/cmm-apps-flutter/EsmorgaFlutter) (Flutter, Cubit/BLoC)
- Backend: [`Esmorga-Backend/esmorga-backend`](https://github.com/Esmorga-Backend/esmorga-backend) (NestJS + MongoDB; ships `swagger.json`)

## Quick start

```bash
npm install
cp .env.example .env       # add your ANTHROPIC_API_KEY
npm run generate           # full run with prose synthesis

# Or run without an API key (TODO placeholders for prose):
npm run generate -- --no-synth
```

Output is written to `docs/` and committed.

## CLI flags

| Flag                          | Effect                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| `--no-synth`                  | Skip Claude. Emit `TODO: prose` placeholders. No API key required.   |
| `--only=<screens\|endpoints\|flows\|architecture>` | Regenerate a single section.                  |
| `--ref-flutter=<branch/sha>`  | Pin the Flutter source to a ref. Defaults to the repo's default branch. |
| `--ref-backend=<branch/sha>`  | Pin the backend source to a ref.                                     |

## Pipeline

1. **fetch** — clone or pull both source repos into `.cache/` (gitignored).
2. **parse** — backend: `swagger.json` + NestJS module graph (ts-morph). Flutter: regex over `lib/**` for routes, screens, cubits, repositories.
3. **analyze** — match Flutter HTTP calls → OpenAPI `operationId`; group into user flows.
4. **render** — deterministic SVG wireframes, Mermaid diagrams, Markdown skeletons.
5. **synth** — Claude fills in 1-paragraph prose per screen/endpoint/flow + architecture overview.
6. **output** — write `docs/**` + Mintlify `docs.json` navigation.

## Filling prose without an API key

If you can't use `ANTHROPIC_API_KEY` (e.g. company policy), the
`scripts/fill-prose.mjs` helper merges prose back into the generated MDX from
a JSON file you can produce by hand or by pasting prompts into Claude Code /
Claude.ai:

```bash
npm run generate -- --no-synth      # writes skeletons with TODO markers
# Produce prose.json with shape: { "docs/api/account/.../foo.mdx": "paragraph...", ... }
node scripts/fill-prose.mjs prose.json
```

Each TODO line in `docs/**/*.mdx` is replaced in place. Re-runs of `generate`
overwrite the bundle, so re-apply prose afterward (or move to a CI step that
chains them).

## Local Mintlify preview

```bash
cd docs
npx mintlify dev
```
