# DISC prototype — Phase 1

Foundation only: Next.js App Router/React, a separate Express API, and PostgreSQL/Prisma configuration. The web entry point is deliberately empty. Scoring integration, assessment UI, authentication, domain tables and reports belong to later phases.

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

The browser calls `/api/*` on the frontend origin. Next.js rewrites the unchanged path to Express; there is no Next.js health handler or scoring implementation. Health is intentionally a liveness check and does not claim the database is connected.

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
```

- Typecheck generates Prisma Client, checks both applications and checks the unchanged reference scorer/tests with strict TypeScript and unchecked-index protection.
- Tests run the 74 reference tests, then the Express HTTP tests using Node's built-in runner. No additional test framework is installed for Phase 1.
- The API build generates Prisma Client and emits ESM JavaScript into `apps/api/dist`.
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

No migrations, assessment data writes or deployment were performed. The folder is not currently a Git checkout, so no Git diff result is claimed. Phase 1's scaffold and available checks are complete; its live database gate remains open.

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
