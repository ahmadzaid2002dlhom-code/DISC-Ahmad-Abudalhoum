# DISC prototype — Phases 1–6

Next.js App Router/React, the Express scoring domain, PostgreSQL models/sessions, staff login, invitations, the complete assessment flow, stored reports and staff dashboards are implemented. Open `/login` for staff navigation: both staff roles can use `/facilitator` to create invitations and view participant rows; only MANAGER can use `/manager` for cohort analytics. Participants use generated `/invite/[token]` links and their stored `/result`. Staff full reports are at `/staff/participants/[id]/report`. The root page remains empty.

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

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, including the provider's required TLS parameters. Needed for DB connection/migration commands, not compilation or health. |
| `API_PORT` | Local Express port; default `4000`. Hosting-provided `PORT` takes precedence. |
| `API_HOST` | Bind address; default `127.0.0.1`. Set `0.0.0.0` on a container/host when required. |
| `API_ORIGIN` | Server-side Express origin for the Next.js rewrite; defaults to `http://localhost:4000`. Set before building production web artifacts. |
| `PUBLIC_APP_URL` | Exact frontend origin for invitation links and mutation Origin checks. Production requires HTTPS. |
| `NODE_ENV` | Development locally; production in deployed processes. |
| `SESSION_SECRET` | At least 32 bytes of random text; required when starting Express. Generate locally; never commit it. |
| `FACILITATOR_SEED_EMAIL`, `FACILITATOR_SEED_PASSWORD` | Explicit facilitator seed credentials; password 12–256 characters. |
| `MANAGER_SEED_EMAIL`, `MANAGER_SEED_PASSWORD` | Distinct manager seed credentials; password 12–256 characters. |
| `TRUSTED_PROXY_CIDRS` | Production: comma-separated explicit IPs/CIDRs of the verified proxy chain. No hop counts, `true`, or catch-all networks. |
| `PROXY_CONFIGURATION_VERIFIED` | Production startup requires `true` after verifying the actual chain described below. |
| `TEST_DATABASE_URL` | Separate PostgreSQL target for integration tests; the suite creates and removes its own random schema. |

## Run locally

```sh
npm run db:deploy
npm run db:seed
npm run dev
```

This applies the committed migration without resetting data, explicitly seeds the two staff accounts, then starts Express on port 4000 and Next.js on port 3000. The root launcher stops the other service if either exits. Visit `http://localhost:3000/login`. Use the exact hostname/port configured in `PUBLIC_APP_URL`; mutations from another origin are rejected.

- Direct API liveness: `http://localhost:4000/api/health`
- Same-origin forwarded liveness: `http://localhost:3000/api/health`
- Both return HTTP 200 with `{"status":"ok","service":"disc-api"}` and `Cache-Control: no-store`.

The browser calls `/api/*` on the frontend origin. Next.js rewrites the unchanged path to Express; Next.js implements neither health nor scoring. Health is intentionally a liveness check and does not claim the database is connected. Scoring and all participant writes remain internal to Express; participant requests never supply trusted scores, dimensions or identity.

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
npm run test:integration  # requires TEST_DATABASE_URL
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

## Prisma and migrations

`apps/api/prisma/schema.prisma` defines the PostgreSQL datasource and ESM client generator. `apps/api/prisma.config.ts` supplies the connection URL from the environment. Prisma 7 uses the PostgreSQL driver adapter; client construction is isolated in `apps/api/src/db/client.ts`.

The Phase 3 schema contains `StaffUser`, `Participant`, `Answer`, `Result` and `Session`. The committed migration creates the tables, enums, indexes and SQL constraints. Results store the four raw scores, shared ranking/tie JSON, SINGLE/TIED, nullable code, every candidate code/content snapshot and all three versions. SQL checks enforce score bounds/total, SINGLE/TIED shape and matching completed participant/result versions and timestamps. TIED follows the same completed invariant as SINGLE. A trigger rejects result updates/deletes. There is no public result-writing API yet.

```sh
npm run db:migrate   # Develop new migrations against a disposable development target
npm run db:deploy    # Apply committed migrations to a configured deployment
npm run db:seed      # Explicitly create the separate staff accounts
```

Seeding hashes passwords with Node's salted scrypt, validates distinct emails, and runs transactionally. Repeating it preserves existing passwords; conflicting existing roles fail instead of silently changing access. Normal server startup never seeds or resets users. Do not use schema resets against an existing database.

## Tested versions and verification

| Component | Version |
| --- | --- |
| Node.js / npm | 24.19.0 / 11.17.0 |
| Next.js | 16.4.2 |
| React / React DOM | 19.3.1 |
| Express | 5.3.0 |
| express-session / its TypeScript types | 1.19.0 / 1.19.0 |
| Prisma CLI / Client / PostgreSQL adapter | 7.10.1 |
| PostgreSQL driver (`pg`) | 8.23.1 |
| TypeScript | 6.0.3 |
| ESLint / typescript-eslint | 10.13.0 / 8.71.2 |
| PostgreSQL server | 18.6, isolated local verification cluster; an existing user database connection was not found. |

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

## Phase 3 access contracts

All personalized API responses, errors and invitation responses use `Cache-Control: no-store`. `/login` is rendered per request and sends no-store headers. Its form uses the same-origin rewrite, labelled fields, a disabled pending state, an announced error/status message and explicit logout. Staff landing/dashboard UI remains outside this phase, so a successful login returns `/login`, which displays the saved principal and sign-out control.

| Endpoint | Phase 3 contract |
| --- | --- |
| `POST /api/auth/login` | JSON `{email,password}`; verifies staff credentials, replaces any prior principal, rotates/saves the session, returns `{principal,redirectTo:'/login'}`. |
| `POST /api/auth/logout` | JSON `{}`; destroys the stored session and clears its host-only cookie; idempotent 204. |
| `GET /api/auth/me` | Returns `{principal}` with one STAFF identity/role or one PARTICIPANT identity/status; otherwise 401. Staff roles are read from the DB on each authorized request. |
| `POST /api/participants` | Either staff role; JSON `{name,email?}`. Creates one INVITED participant with pinned assessment/scoring/text versions. Returns `{participant,invitationUrl}` once. No staff-specific cohort partition. |
| `GET /api/participants` | Either staff role; all cohort participants with `result:null` while pending, or stored completed result content. Never returns invite hashes/tokens or staff credentials. |
| `GET /api/participants/:id/report` | Staff only; stored completed report, 404 for unknown participant, 409 for pending. |
| `POST /api/invitations/redeem` | JSON `{token}`. Checks a SHA-256 hash and expiry under a participant-row lock; starts an INVITED participant once, rotates/saves a participant-only session and returns a clean `/assessment` or `/result` path. |
| `GET /api/assessment/result` | Participant session only; selects the owner exclusively from the session. Returns their stored result, or 409 if pending. Client IDs/posted scores never select a report. |
| `/api/manager/*` | MANAGER guard is active. The summary endpoint itself belongs to Phase 6 and currently returns 404 to an authorized manager. |

An invitation uses 32 cryptographically random bytes and expires after seven days. Its URL is `/invite#token=…`; the fragment keeps the token out of HTTP GET requests, normal access logs and Referrer. The invite/start screen and token extraction are Phase 4 work. GET never redeems an invitation. Unexpired invites may be reused to resume the same participant; a completed participant returns to their immutable stored report, including TIED reports. Expired/unknown tokens share a generic 400. An unavailable pinned seed/policy returns a clear 409 rather than substituting a new version. No answer-write or submission endpoint is implemented yet.

## Session and production configuration

Sessions use `express-session` with a PostgreSQL store implemented against the Prisma `Session` model; there is no MemoryStore fallback. The cookie contains a signed opaque ID; only its SHA-256 hash is stored in the database. Session JSON is constrained to `cookie` and exactly one discriminated STAFF or PARTICIPANT principal. Roles/passwords/invite tokens are not copied into session data. Each authentication or redemption destroys the previous session ID, replaces the principal and explicitly awaits the new save before returning a navigation target. Failed saves return generic errors without issuing a new authenticated cookie. Logout revokes the stored ID. Reads never renew the absolute eight-hour lifetime; expired rows are removed on access and during subsequent session writes.

Development uses `disc.sid`; production uses `__Host-disc.sid`, HttpOnly, Secure, SameSite=Lax, Path=/, an explicit eight-hour expiry, and no Domain. Every mutation, including login/redeem/logout, requires the exact configured browser Origin and `application/json`. Missing/foreign/null Origins fail; no permissive CORS or missing-Origin fallback is installed.

Production startup fails unless `PUBLIC_APP_URL` is HTTPS, `SESSION_SECRET` is a non-placeholder random secret, explicit trusted proxy IPs/CIDRs are set, and `PROXY_CONFIGURATION_VERIFIED=true`. Verify the actual deployment before setting that acknowledgement: Express must be reachable only through the intended proxy chain; the edge must replace untrusted Forwarded/X-Forwarded-* headers; the Next rewrite and intervening proxies must preserve the verified HTTPS protocol and cookies. Test a secure cookie through the hosted frontend, rejected spoofed headers from an untrusted address, correct client-IP handling and logout before accepting the deployment. A configuration flag alone does not prove the hosted chain is correct. Hosted verification remains Phase 8; local tests cover the trusted/untrusted proxy behavior. See the official [Express session documentation](https://expressjs.com/en/resources/middleware/session/) and [proxy documentation](https://expressjs.com/en/guide/behind-proxies/).

## Phase 3 checks — 16 October 2026

No existing PostgreSQL service/listener, configured DATABASE_URL or project environment file was found. For verification only, official portable PostgreSQL 18.6 binaries were downloaded to an OS temporary directory and a password-protected cluster was bound to `127.0.0.1:55432`. No Windows service, external database, real staff account or deployment was created. Credentials stayed outside the repository/output. Configure your intended persistent database and staff values in root `.env.local`, then run `db:deploy` and `db:seed` for normal use. The verification processes are stopped after checking.

| Check | Actual final result |
| --- | --- |
| `npm test` | PASS, exit 0: 74 reference + 109 API tests = 183 passed, 0 failed/skipped. |
| `npm run test:integration` with isolated `TEST_DATABASE_URL` | PASS, exit 0: 12 real PostgreSQL/HTTP tests, 0 failed/skipped. Both roles/shared cohort, wrong credentials/tokens, expiry, session switching/revocation, API/store recreation, failed durable save, unavailable pinned version, SINGLE/TIED snapshots and report isolation, immutable-result/completion constraints and secure-cookie/proxy behavior. |
| `npm run test:built` | PASS, exit 0: 3 packaged-source/scorer tests. Combined total: 198 tests passed. |
| `npm run typecheck` | PASS, exit 0: API/web/reference strict types; API also enforces Node-compatible erasable TypeScript syntax. |
| `npm run lint` | PASS, exit 0, no errors/warnings. |
| `npm run db:validate` | PASS, exit 0. |
| `npm run build` | PASS, exit 0: packaged API and optimized Next build; `/login` is dynamic. |
| `npm run db:deploy` twice on isolated verification DB | PASS, both exit 0: migration applied, then no pending migrations. |
| `npm run db:seed` twice on isolated verification DB | PASS, both exit 0: two distinct roles, existing hashes preserved. |
| `npm run db:check` on isolated verification DB | PASS, exit 0: Prisma SELECT 1. |
| Built same-origin smoke | PASS: login HTML/no-store, health rewrite, forwarded cookie, login/me, invitation creation, logout and old-cookie rejection. |
| Browser check of built frontend | PASS: facilitator login, switch to manager, refresh preserves manager, logout removes identity. |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | PASS, exit 0: lockfile/manifests agree. |
| `git diff --check` | PASS, exit 0. |

Integration tests require a separate `TEST_DATABASE_URL`; missing configuration fails explicitly rather than skipping. They create and drop only a random `disc_test_*` schema within that database, and use fictional staff/participants. They apply the same committed SQL migration used by `db:deploy`. They never truncate/reset public tables. Seed/result fixtures are inserted directly for access testing; they do not add a premature scoring/submission API.

Phase 3 changed files: `.env.example`, `README.md`, root `package.json`/`package-lock.json`, `apps/api/package.json`, `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts`, `apps/api/tsconfig.json`, `apps/web/next.config.mjs` and Next's generated `apps/web/next-env.d.ts` (production type paths).

Phase 3 added files:

```text
apps/api/prisma/migrations/migration_lock.toml
apps/api/prisma/migrations/202610160001_phase3_access/migration.sql
apps/api/src/auth/password.ts
apps/api/src/auth/seed.ts
apps/api/src/auth/session.ts
apps/api/src/db/seed.ts
apps/api/src/http/access.ts
apps/api/src/http/errors.ts
apps/api/src/http/reports.ts
apps/api/test/access.test.ts
apps/api/test/integration/access.test.ts
apps/web/src/app/login/page.tsx
apps/web/src/app/login/login-form.tsx
```

## Phase 4 — confirmed assessment and atomic completion

`/invite/[token]` renders a read-only invitation; only its **Start or continue** button posts to `/api/invitations/redeem`. Successful redemption waits for the rotated PostgreSQL session to be saved, then replaces the current URL with `/assessment` or `/result`. New invitations now use the requested path route. Existing Phase 3 `/invite#token=…` links still work through a render-only compatibility page. Invitation/assessment/receipt pages are dynamic and send no-store, no-referrer and noindex headers. Next development request logging is disabled so path tokens are not logged; deployment access logs must also redact `/invite/*` paths.

`GET /api/assessment` returns only status, assessment version, group IDs/sequence, visible English/Arabic words with opaque IDs, and the current participant's confirmed rankings/timestamps. It never creates answers or returns dimensions, rank weights, profile mappings or private source data. A completed participant gets a clean result destination without loading a newer seed.

The frontend uses modern `@dnd-kit/react` **0.5.1**, compatible with the pinned React 19 version, plus labelled Move Up/Down buttons. Dragging and keyboard controls edit the same ordered ID array. Each move has a live announcement; focus follows group changes and the controls have visible focus and 44px targets. English and Arabic text are shown together without a language-toggle dependency.

Every Next action explicitly PUTs the current order, even if unchanged. Only a successful committed save marks it confirmed and advances. Back preserves local drafts; refresh/redeem resumes saved PostgreSQL answers and the first unconfirmed group. Untouched groups have no Answer row. A failed save keeps the current order and group and offers retry. A synchronous in-flight latch and disabled controls serialize actions. The last group must be separately confirmed before Submit enables. Submit always flushes that group again and awaits it before POSTing submission. Dirty drafts elsewhere prevent submission. A completed conflict, including retry after a lost submit response, resolves to the stored result rather than attempting another edit.

| Endpoint | Phase 4 behavior |
| --- | --- |
| `GET /api/assessment` | Participant only, consistent read snapshot, public words plus own confirmed answers; no default-answer writes. |
| `PUT /api/assessment/answers/:groupId` | Participant only, JSON `{rankedWordIds}` only. Under a Participant `FOR UPDATE` lock, check status/pinned policies, validate the exact four-word permutation, then upsert one confirmed answer. |
| `POST /api/assessment/submit` | Participant only, JSON `{}`. Acquire the same parent-row lock before checking status. If already completed, return the immutable stored result immediately. Otherwise validate all 14 confirmed groups, score once, insert the full versioned result/candidate snapshot and mark COMPLETED in the same transaction. |

Writes use parameterized SQL row locks in Prisma Read Committed transactions. The existing unique result constraint and SQL completion/immutability checks remain safeguards. Late valid answer writes return 409. Incomplete or corrupt saved assessments return 409 without creating a result. Invalid PUT payloads return 400. Origin/JSON checks, staff-versus-participant authorization and no-store behavior from Phase 3 remain active. Participant IDs always come from the session.

`/result` is the Phase 4 completion receipt: SINGLE or TIED, every candidate's exact stored code and N-slogan name/description, and a locked-answer confirmation. It reads the participant-owned stored result. The full score table/chart/ranking/report layout remains Phase 5; no dashboard or deployment work was added. No schema change or new migration is needed for this phase because Phase 3 already created the Answer/Result models.

### Phase 4 verification — 16 October 2026

Checks used the existing isolated local PostgreSQL **18.6** verification runtime with fictional participants and staff. The intended user database credentials remain unconfigured. Browser fixtures used a separate `disc_phase4_verification` database; integration suites each created/dropped their own random schema. Temporary failure/delay triggers were scoped to fictional browser participants and removed after verification. Frontend/API test processes and the test database server are stopped after checking.

| Check | Actual final result |
| --- | --- |
| `npm test` | PASS, exit 0: 74 reference + 109 API tests = 183 passed, 0 failed/skipped. |
| `npm run test:integration` | PASS, exit 0: 26 real PostgreSQL/HTTP tests = 12 access + 14 assessment tests, 0 failed/skipped. |
| `npm run test:built` | PASS, exit 0: 3 packaged-source tests. Combined total across commands: **212 passed**. |
| `npm run lint` | PASS, exit 0, no errors/warnings. |
| `npm run typecheck` | PASS, exit 0: API, web and reference. |
| `npm run db:validate` | PASS, exit 0; existing schema unchanged in Phase 4. |
| `npm run build` | PASS, exit 0: compiled API, packaged private seed and optimized Next build; invite, assessment and result routes dynamic. |
| Migration/seed for browser DB | PASS: existing committed migration applied and separate fictional staff accounts explicitly seeded. |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | PASS, exit 0: manifests and lockfile agree. |
| `git diff --check` | PASS, exit 0. |

Assessment integration tests verify DTO allowlists and ownership, no untouched answers, unchanged-order confirmation, exact/foreign/invalid IDs, failed-save rollback/retry/resume, missing/corrupt saved groups, all SINGLE/tie examples (including all-four and lower-only ties), completion rollback and immutable old-version retries. Eight simultaneous submits are held behind an actual PostgreSQL parent-row lock and return the same single stored result. Both answer-first and submit-first races use real lock queues observed through `pg_stat_activity`: the earlier answer is scored, or the late answer is rejected. These are database tests, not simulated mutex tests.

Browser verification used the built frontend through the real same-origin rewrite at **375px width**. Confirmed: invite GET leaves INVITED/zero answers; explicit Start reaches a token-free URL; Enter on Move Down reorders and retains focus; pointer drag reorders; no horizontal overflow; database-induced failure leaves edits/group/count unchanged; retry saves once; Back and refresh restore the saved order. Thirteen unchanged-order keyboard confirmations produced exactly 13 rows and left Submit disabled. A final unsaved edit survived Back/Next, then final confirmation produced 14 rows. A forced final-flush failure/timeout kept IN_PROGRESS and zero results, with all actions disabled while pending. Removing the test gate and retrying completed atomically with 14 answers, one SINGLE result and total 140. Reopening `/assessment` returned the stored locked completion receipt. All TIED completion variants and candidate snapshots are additionally covered by the PostgreSQL HTTP suite.

Phase 4 modified files: `README.md`, `package-lock.json`, `apps/web/package.json`, `apps/web/next.config.mjs`, `apps/api/src/app.ts` and the invitation URL helper in `apps/api/test/integration/access.test.ts`. Phase 3 changes already present in the working tree were retained.

Phase 4 added files:

```text
apps/api/src/services/assessment.ts
apps/api/test/integration/assessment.test.ts
apps/web/src/lib/http.ts
apps/web/src/lib/assessment-types.ts
apps/web/src/components/assessment.module.css
apps/web/src/components/ranked-words.tsx
apps/web/src/app/invite/page.tsx
apps/web/src/app/invite/[token]/page.tsx
apps/web/src/app/invite/invite-start.tsx
apps/web/src/app/assessment/page.tsx
apps/web/src/app/assessment/assessment-flow.tsx
apps/web/src/app/result/page.tsx
apps/web/src/app/result/completion.tsx
```

Implementation references: [PostgreSQL row locks](https://www.postgresql.org/docs/18/explicit-locking.html), [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions), and [modern dnd-kit sortable state](https://dndkit.com/react/guides/sortable-state-management/).

## Phase 5: stored participant and staff reports

`/result` replaces the Phase 4 receipt with the participant-owned report from `GET /api/assessment/result`. `/staff/participants/[id]/report` reads `GET /api/participants/:id/report`; FACILITATOR and MANAGER retain access to the shared demo cohort. Both routes use the same presentation component and fetch with no-store caching. The staff route is dynamic and sends private no-store/no-referrer/noindex headers. Its initial HTML contains no participant data; the role-protected API supplies authorized content. No staff listing/dashboard work is included in this phase.

Reports render the stored four scores, total, exact shared-rank groups and a fixed 0–56 chart plus accessible table. SINGLE displays its ordered code; TIED explicitly labels the tie and shows every stored candidate without selecting a winner. Each candidate shows the exact saved N source name/short description once when those fields match. Null English descriptions are accepted silently. DI and ID retain their distinct slogans. Four equal scores show all 12 candidates; a third/fourth-place tie alone leaves the uniquely highest two as SINGLE. No browser scoring, source lookup, private mapping import or completed-result update occurs.

Pending invitations and in-progress assessments show “Report pending” with no provisional scores. Authentication, forbidden and nonexistent-report responses have distinct messages; failed requests offer Reload report. Participants can return to their assessment from a pending own report. Stored versions and candidate content remain the API's existing pinned snapshots, including older versions.

### Phase 5 verification — 16 October 2026

All checks passed: `npm test` **193** (74 reference + 109 API + 10 report-render tests), `npm run test:integration` **35** (12 access + 14 assessment + 9 reports), `npm run test:built` **3**. Across these commands: **231 passed, 0 failed/skipped**. Lint, typecheck, Prisma validation, API/optimized Next build, offline lockfile dry-run and whitespace checks exited 0. The whitespace check reports existing LF/CRLF conversion notices. Runtime/library versions remain those recorded above; actual database verification used PostgreSQL **18.6**.

Browser checks used the built app and fictional participants in a separate local database: DI versus ID, DI/ID, DI/DS, all-four/lower-only ties, exact slogans, pending states, own/staff access and a 375px mobile report. [Screenshots, observed cases and exact command results](artifacts/phase5/EVIDENCE.md) are saved in the repository. Intended user database credentials remain unconfigured. Temporary verification processes were stopped; no deployment was performed.

Phase 5 modified files: `README.md`, `package.json`, `eslint.config.mjs`, `apps/web/next.config.mjs`, `apps/web/src/lib/assessment-types.ts` and `apps/web/src/app/result/page.tsx`. The obsolete `apps/web/src/app/result/completion.tsx` was removed. Earlier-phase changes already present in the working tree and included reference files were preserved.

Phase 5 added files:

```text
apps/web/src/lib/report-types.ts
apps/web/src/components/report.module.css
apps/web/src/components/stored-report.tsx
apps/web/src/components/report-screen.tsx
apps/web/src/app/staff/participants/[id]/report/page.tsx
apps/api/test/integration/reports.test.ts
tests/report-render.test.ts
tsconfig.tests.json
artifacts/phase5/EVIDENCE.md
artifacts/phase5/*.jpg
```

## Phase 6: persisted staff tables and manager overview

`/facilitator` provides invitation creation/copy and a shared participant table for FACILITATOR and MANAGER. `/manager` adds manager-only cohort analytics and uses the same table/form. Login now links to the authorized screens, and staff reports link back to participant management. Both screens render dynamically, fetch no-store and send no-store/no-referrer/noindex headers. Initial HTML contains no cohort data; all data comes from the role-protected Express APIs.

Tables show status, four stored completed scores, SINGLE ordered code or every TIED candidate with its exact saved N source name, and completed full-report links. Pending rows show dashes and no final profile/report link. Existing snapshot text is used without re-scoring or current-seed substitution. The focusable horizontal table region supports small screens and keyboard scrolling.

Creating an invitation uses the existing Origin-protected `POST /api/participants`. The returned link remains visible for copying, including while the table refreshes; clipboard failures offer manual selection/copy. A newly created row is loaded from PostgreSQL. Subsequent list/summary reads never return tokens or hashes; invitation links are returned only at creation. No delivery integration or token-retrieval feature was added.

`GET /api/participants` now reads the shared cohort in a PostgreSQL **Repeatable Read** transaction so participant and Result relation queries share one snapshot. `GET /api/manager/summary` is MANAGER-only and derives its participant table and every metric from that same materialized cohort read:

| Response field | Definition |
| --- | --- |
| `totalInvited` | N = all Participant invitation records, regardless of status |
| `completed` | K = COMPLETED participants with stored results, including TIED |
| `pending` | P = INVITED + IN_PROGRESS |
| `completionPercentage` | `100 * K / N`, or 0 when N=0; UI rounds to two decimals |
| `distribution` | All 12 ordered SINGLE code keys plus one exclusive TIED key; each completed participant counted once; sum=K |
| `means` | D/I/S/C raw score averages across all K completed results, including TIED; null when K=0; UI rounds to two decimals |
| `participants` | Same snapshot and stored-result DTOs used for the displayed table |

There are no separate count/mean queries, per-staff ownership filters, optimistic fake totals or per-candidate distribution counts. Failed refreshes retain the complete previous snapshot with an explicit retry message; authorization failures remove it. Every request rechecks the persisted staff role. No schema migration, dependency or scoring change is required.

### Phase 6 verification — 16 October 2026

Final checks: `npm test` **201 passed** (74 reference + 109 API + 18 React rendering tests), `npm run test:integration` **43 passed** (12 access + 14 assessment + 9 reports + 8 cohort), and `npm run test:built` **3 passed**. Combined: **247 passed, 0 failed/skipped**. Typecheck, lint, optimized API/Next build, Prisma validation, offline lockfile dry-run and whitespace checks exited 0. Existing dependency versions remain unchanged; real DB tests used PostgreSQL **18.6**.

The six-person fixture verified N=6, K=4, P=2; completion `100*4/6`; distribution CD=1, DI=1, IS=1, TIED=1; means D/I/S/C = 40.25/40.25/31.5/28. Empty, no-completed, all-tied and all-12-SINGLE cohorts passed real PostgreSQL tests. A controlled concurrent completion held a real Result-table lock while the HTTP summary read waited: the response kept the old complete snapshot, and the next request returned the new completion. Anonymous/participant/facilitator analytics access, live manager-role revocation, both-role shared lists and creation-only invitation links were tested.

The built browser flow verified the six persisted participants, exact summary/table values, source text, full-report navigation, facilitator denial, invitation creation/copy, refresh persistence and 375px keyboard table scrolling. An added invitation changed the live summary to N=7, K=4, P=3 without changing the completed distribution or means. [Screenshots and detailed evidence](artifacts/phase6/EVIDENCE.md) use only fictional records in a separate local database; intended user database credentials remain unconfigured. Temporary app/database processes were stopped. No deployment, commit or push was performed for Phase 6.

Phase 6 modified files: `README.md`, `package.json`, `apps/api/src/app.ts`, `apps/api/test/integration/access.test.ts`, `apps/web/next.config.mjs`, `apps/web/src/app/login/login-form.tsx` and `apps/web/src/components/report-screen.tsx`.

Phase 6 added files:

```text
apps/api/src/http/participants.ts
apps/api/src/services/cohort.ts
apps/api/test/integration/cohort.test.ts
apps/web/src/app/facilitator/page.tsx
apps/web/src/app/manager/page.tsx
apps/web/src/lib/staff-types.ts
apps/web/src/components/staff.module.css
apps/web/src/components/staff-screen.tsx
apps/web/src/components/invite-form.tsx
apps/web/src/components/participant-table.tsx
apps/web/src/components/manager-metrics.tsx
tests/staff-render.test.ts
artifacts/phase6/EVIDENCE.md
artifacts/phase6/*.jpg
```
