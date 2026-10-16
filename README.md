# DISC prototype — Phases 1–2

Next.js App Router/React, a separate Express API, PostgreSQL/Prisma configuration, and the server-only DISC scoring domain are implemented. The web entry point is deliberately empty. Assessment UI, authentication, domain tables, answer persistence and reports belong to later phases.

The original playbook, private seed, workbook and reference scorer/tests are preserved. Start with `README_START_HERE.md` for the complete phase sequence.

## Requirements and installation

- Node.js 24 LTS, at least 24.11.0 and below 25; npm with workspace support.
- An existing persistent PostgreSQL database for the connection check and later migrations.
- Network access to npm and Prisma's generator download service during installation/generation.

From the repository root:

```sh
npm ci
npm run db:generate
```

The committed lockfile pins the dependency graph. `npm install` was used to create it initially. Both workspaces share the root compiler and lint tooling. The dependency-free reference command is unchanged:

```sh
npm run check:pack
```

## Environment setup

Copy `.env.example` to `.env.local` at the repository root and set `DATABASE_URL` for your existing development database. Keep credentials out of source control. No database is provisioned or reset automatically.

All workspace entry points load the root environment using Node's built-in environment-file loader. Precedence is existing process variables, then root `.env.local`, then root `.env`. Files are resolved relative to the loader, not the current working directory. The loader never reads `.env.example` and never prints values. No `NEXT_PUBLIC_` secrets are used.

| Variable | Phase 1 purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, including the provider's required TLS parameters. Needed for DB connection/migration commands, not compilation or health. |
| `API_PORT` | Local Express port; default `4000`. Hosting-provided `PORT` takes precedence. |
| `API_HOST` | Bind address; default `127.0.0.1`. Set `0.0.0.0` on a container/host when required. |
| `API_ORIGIN` | Server-side Express origin for the Next.js rewrite; defaults to `http://localhost:4000`. Set before building production web artifacts. |
| `PUBLIC_APP_URL` | Reserved frontend URL for later invitations/Origin checks. |
| `NODE_ENV` | Development locally; production in deployed processes. |
| Session/staff variables | Reserved for Phase 3; no login/session code exists yet. |

## Run locally

```sh
npm run dev
```

This starts Express on port 4000 and Next.js on port 3000. The root launcher stops the other service if either exits. The empty root page is the required App Router scaffold, without assessment UI.

- Direct API liveness: `http://localhost:4000/api/health`
- Same-origin forwarded liveness: `http://localhost:3000/api/health`
- Both return HTTP 200 with `{"status":"ok","service":"disc-api"}` and `Cache-Control: no-store`.

The browser calls `/api/*` on the frontend origin. Next.js rewrites the unchanged path to Express; Next.js implements neither health nor scoring. Health is intentionally a liveness check and does not claim the database is connected. The scoring domain is internal to the API, without a public scoring/assessment route in Phase 2.

```sh
npm run db:check
```

This uses the generated Prisma client and PostgreSQL driver adapter to execute only `SELECT 1`; it creates no tables or data. Missing credentials, an unreachable server or query failure produce a nonzero exit without printing connection strings. Driver connection/query timeouts are five seconds.

## Checks and build

```sh
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
npm run test:built
```

- Typecheck generates Prisma Client, checks both applications and checks the unchanged reference scorer/tests with strict TypeScript and unchecked-index protection.
- Tests run the 74 reference tests, then the API scoring, workbook-fidelity and HTTP tests using Node's built-in runner. No additional test framework is installed.
- The API build generates Prisma Client, emits ESM JavaScript into `apps/api/dist`, validates the private source fingerprint, and copies the original seed bytes to `apps/api/dist/data/disc-assessment-seed.json`.
- `test:built` runs after a build and tests the compiled scorer/loader in isolated temporary folders, including missing/tampered private-data failures.
- The web build creates the Next.js production artifact in `apps/web/.next`.
- Generation, typechecking and builds do not require live database access. Generated client files, build output, local environments and dependencies are ignored by Git.

To run the built services in separate terminals:

```sh
npm run start:api
npm run start:web
```

## Prisma and later migrations

`apps/api/prisma/schema.prisma` defines the PostgreSQL datasource and ESM client generator. `apps/api/prisma.config.ts` supplies the connection URL from the environment. Prisma 7 uses the PostgreSQL driver adapter; client construction is isolated in `apps/api/src/db/client.ts`.

The schema has no domain models in Phase 1. Phase 3 will introduce the participant, answer, immutable result, staff and durable session tables and their migrations.

```sh
npm run db:migrate   # Development migration workflow once domain models exist
npm run db:deploy    # Apply committed migrations to a configured deployment
```

There is no seed command yet; explicit staff seeding belongs to Phase 3. Do not use schema resets against the existing database.

## Tested versions and verification

| Component | Version |
| --- | --- |
| Node.js / npm | 24.19.0 / 11.17.0 |
| Next.js | 16.4.2 |
| React / React DOM | 19.3.1 |
| Express | 5.3.0 |
| Prisma CLI / Client / PostgreSQL adapter | 7.10.1 |
| PostgreSQL driver (`pg`) | 8.23.1 |
| TypeScript | 6.0.3 |
| ESLint / typescript-eslint | 10.13.0 / 8.71.2 |
| PostgreSQL server | Not verified: no `DATABASE_URL` was supplied. |

Prisma 8 is currently a release candidate, so this scaffold uses stable Prisma 7. TypeScript 6.0.3 satisfies the installed typescript-eslint peer range. The official `@next/eslint-plugin-next` supplies the Next.js rules directly, alongside TypeScript lint rules, without the full preset's ESLint 9-only transitive plugins. Versions were checked against npm metadata before installation. Only the pinned Prisma CLI/engine installation scripts are approved in the root manifest.

Implementation references: [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites) and [Prisma 7 client/configuration](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

Verification on 16 October 2026:

| Check | Actual result |
| --- | --- |
| Clean `npm install` | PASS, exit 0; 373 packages installed without peer warnings after selecting compatible lint dependencies. |
| `npm run lint` | PASS, exit 0; no errors or warnings. |
| `npm run typecheck` | PASS, exit 0; both applications and original reference scorer/tests. |
| `npm test` | PASS, exit 0; 74 reference tests + 2 Express HTTP tests, 76 total, 0 failures. |
| `npm run db:validate` | PASS, exit 0; PostgreSQL schema valid. |
| `npm run build` | PASS, exit 0; Prisma generation, API ESM compilation and optimized Next.js production build. |
| `npm ls --all --json` | PASS, exit 0; no dependency-tree problems. |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | PASS, exit 0; manifests and lockfile agree. This was a dry run, not a second full installation. |
| Root `npm run dev` | PASS startup; direct health, forwarded health and `/` returned HTTP 200. Smoke processes were intentionally stopped afterward. |
| Production startup smoke | PASS, exit 0; built API and Next.js CLI started, both health paths returned exact JSON with `no-store` and no `x-powered-by`, forwarded unknown route returned API JSON 404, `/` returned 200. Processes stopped in cleanup. |
| `npm run db:check` | EXIT 1: `DATABASE_URL` is absent from process/root environment. A live PostgreSQL connection has not been verified. Configure the existing database and rerun this command to satisfy the remaining Phase 1 database gate. |
| In-app browser navigation | BLOCKED by browser client: `net::ERR_BLOCKED_BY_CLIENT` for localhost. No browser rendering pass is claimed; HTTP checks passed independently. |
| Original pack preservation | PASS: all 13 original guidance/source/reference files retain their initial SHA-256 hashes; `check:pack` command unchanged. |
| Built web assets | PASS: private seed filename, a known opaque word ID and scoring-policy marker absent from web server/static artifacts. |

No migrations, assessment data writes or deployment were performed. The folder was not a Git checkout during Phase 1 verification; Git was initialized afterward for the requested Phase 1 commit. Phase 1's scaffold and available checks are complete; its live database gate remains open.

## Phase 1 file inventory

Modified: `.env.example`, `package.json`.

Added source/configuration files (generated files are excluded):

```text
.gitignore
README.md
package-lock.json
eslint.config.mjs
tsconfig.base.json
tsconfig.reference.json
scripts/load-env.mjs
scripts/load-env.d.mts
apps/api/package.json
apps/api/tsconfig.json
apps/api/tsconfig.build.json
apps/api/prisma.config.ts
apps/api/prisma/schema.prisma
apps/api/src/app.ts
apps/api/src/env.ts
apps/api/src/server.ts
apps/api/src/db/client.ts
apps/api/src/db/check.ts
apps/api/test/health.test.ts
apps/web/package.json
apps/web/AGENTS.md
apps/web/tsconfig.json
apps/web/next-env.d.ts
apps/web/next.config.mjs
apps/web/src/app/layout.tsx
apps/web/src/app/page.tsx
```

`apps/web/AGENTS.md` is generated by Next.js 16.4's development server and points to its bundled version-specific documentation. The original root `AGENTS.md` is unchanged. Prisma client files, `.next`, `dist`, dependency files and TypeScript caches are generated/ignored artifacts, not authored source changes.

## Phase 2 — source validation and scoring

`apps/api/src/domain/scoring.ts` adapts the preserved reference scorer as the API's only scoring implementation. It exposes `validateAssessmentSeed`, `validateGroupAnswer`, `scoreAssessment` and `toPublicAssessment`. It has no DB, session or HTTP side effects. The unchanged reference implementation remains a reference/test input only; application code does not import it.

`loadAssessmentSeed(version)` in `apps/api/src/data/assessment.ts` loads and deeply freezes the approved private data. It rejects unavailable assessment versions and changed seed bytes. These policies are pinned:

```text
assessmentVersion:       disc-2024-english-arabic-v1.2
scoringPolicyVersion:    score-ties-visible-v2
profileTextPolicyVersion: excel-slogan-as-description-v1
workbook SHA-256:        57b23a2a2b8679ba669e3657d282c053bb26ec6a7da5965388adf6f89dcdaf60
private seed SHA-256:    5c6cec273ef5282e3cf926ba4b72032c45407e149d197497bcc3e4d6d5895e37
```

The source audit reads the supplied XLSX ZIP/XML directly in the API tests. It verifies the named worksheet, used range, exact word/profile source cells and workbook fingerprint. All 14 groups, 56 IDs, bilingual text, mappings, C6/C7 join, both Daring IDs, 12 ordered codes, N slogans and raw P/Q/R are preserved. Row 1 is excluded. Extroverted remains D. L/M profile letters are case-normalized from the workbook; only incidental surrounding cell whitespace is trimmed. `.gitattributes` prevents Git newline conversion from changing the fingerprinted source bytes on another OS.

Each answer must contain the exact four-word permutation for one known group. Full scoring requires all 14 known group IDs once, assigns 4/3/2/1 by participant order, enforces total 140 and each dimension 14–56, and retains shared competition ranks for equal scores. Candidates depend only on score totals: each first must be maximal, and its second maximal among the remainder. One candidate is SINGLE with its code; several are TIED with null `profileCode`/`profile`. Every candidate includes a detached copy of its exact source profile content. Lower-only ties preserve a unique highest two.

N supplies `labelAr`, `nameAr` and `descriptionAr`; `descriptionEn` remains null. No invented prose or missing-description state is introduced. Public word DTOs explicitly select only assessment version, group ID/sequence, and word ID/English/Arabic text. A web lint rule rejects imports of API/private-seed/reference modules. No private data is copied into web artifacts.

Runtime paths are independent of the working directory: native `.ts` execution loads the original repository seed; compiled `.js` execution loads only its adjacent packaged private JSON. A compiled loader never falls back to a repository source file. Build/deploy the full API `dist` directory, including that private JSON; never serve it as static/public content. Workbook ZIP/XML readers (`fflate` 0.8.3 and `fast-xml-parser` 5.11.2) are development-only dependencies; the runtime loader/scorer uses only Node built-ins.

Verification on 16 October 2026:

| Phase 2 check | Actual result |
| --- | --- |
| `npm test` | PASS, exit 0: 74 preserved reference tests + 104 API tests = 178 passed, 0 failed, 0 skipped. API coverage includes 1,000 mixed responses checked against an independent 24-permutation candidate/rank oracle. |
| Workbook/source audit, included in API tests | PASS: exact SHA-256 and all 56 word/translation/mapping source entries plus all 12 ordered profiles and N/P/Q/R cells. Deliberately changing each of the 112 word-language values or 72 profile-text/raw fields fails the independent cell audit. |
| `npm run typecheck` | PASS, exit 0: API, web and preserved reference files; strict and unchecked-index checks enabled. |
| `npm run lint` | PASS, exit 0: no errors/warnings. |
| `npm run build` | PASS, exit 0: API ESM + private seed packaging, and optimized Next.js build. |
| `npm run test:built` | PASS, exit 0: 3 tests, 0 failures. Isolated compiled SINGLE/TIED scoring works; missing or tampered packaged data is rejected. Total across both test commands: 181 passed. |
| Private API artifact | PASS: packaged seed bytes exactly equal the original JSON. |
| Web import boundary probe | PASS: lint rejects imports of the private JSON, API scorer and reference scorer. |
| Built web server/static assets | PASS: private seed filename, known opaque word ID and scoring-policy marker absent. |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | PASS, exit 0: updated manifests and lockfile agree. |
| `git diff --check` | PASS, exit 0. |
| Original pack preservation | PASS: all 13 original guidance/source/reference files retain their pre-Phase-2 SHA-256 hashes. |

No answer/submit endpoint, persistence, authentication, report UI or dashboard is implemented in this phase. The missing live PostgreSQL configuration from Phase 1 does not prevent these pure-domain checks. No commit or deployment was performed for Phase 2.

Phase 2 modified files: `README.md`, `package.json`, `package-lock.json`, `eslint.config.mjs`, `apps/api/package.json`.

Phase 2 added files:

```text
.gitattributes
apps/api/src/domain/scoring.ts
apps/api/src/data/assessment.ts
apps/api/test/helpers/assessment.ts
apps/api/test/helpers/workbook.ts
apps/api/test/scoring.test.ts
apps/api/test/source.test.ts
apps/api/test/build/packaged-seed.test.ts
scripts/package-api-seed.mjs
```
