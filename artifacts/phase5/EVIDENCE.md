# Phase 5 verification — 16 October 2026

Screenshots are from the optimized Next.js build, Express API and real PostgreSQL 18.6, through the same-origin rewrite. All names/accounts are fictional QA data. Six completed browser participants were created, redeemed, given 14 confirmed answers and submitted through the actual APIs. The separate `disc_phase5_verification` database was used; intended user database credentials are still unconfigured. Temporary frontend/API/database processes were stopped after verification.

## Report examples

Scores below use D/I/S/C order. The chart always spans 0–56; the accessible table includes all four raw scores, shared ranks and total 140. Reports read stored Result snapshots; the browser does not import the scorer or private seed.

| Case | Scores | Observed result | Screenshot |
| --- | --- | --- | --- |
| DI | 56/42/28/14 | SINGLE DI — المقنع | [DI](single-di.jpg) |
| ID | 42/56/28/14 | SINGLE ID — الملهم | [ID](single-id.jpg) |
| First-place tie | 49/49/28/14 | TIED: DI — المقنع, ID — الملهم; D/I share rank 1 | [DI/ID](tied-di-id.jpg) |
| Second-place tie | 56/35/35/14 | TIED: DI — المقنع, DS — النتائج بمنهجية; I/S share rank 2 | [DI/DS](tied-di-ds.jpg) |
| All four equal | 35/35/35/35 | TIED: all 12 ordered candidates, one rank-1 group | [All four](all-four-tied.jpg) |
| Third/fourth tie only | 56/42/21/21 | SINGLE DI; S/C share rank 3 | [375px mobile](lower-only-mobile.jpg) |

All 12 codes appeared: DI, DS, DC, ID, IS, IC, SD, SI, SC, CD, CI, CS. Each card displays its exact stored N slogan. Identical name/description values render once per card. IC and CI remain separate cards even though they share source text. Null English descriptions cause no missing-description notice. No candidate is selected as a tie winner.

The mobile screenshot was captured at a 375×812 viewport; measured document width was 360px, with no horizontal overflow. Desktop and mobile screenshots were visually inspected. Browser error logs were empty at the end of the report checks.

## Pending and access checks

| Check | Observed behavior | Screenshot |
| --- | --- | --- |
| Unauthenticated staff report | Sign in required; no report data | Verified in browser before sign-in |
| Participant opening another participant's staff report | Report access denied; no scores or source content | [Denied](participant-staff-denied.jpg) |
| Own in-progress assessment | Report pending; Continue assessment link; zero charts/tables | [Participant pending](participant-pending.jpg) |
| FACILITATOR completed report | Stored DI/ID tie and fictional participant name visible | [Facilitator](facilitator-report.jpg) |
| FACILITATOR unstarted invitation report | Report pending; no provisional result | [Staff pending](staff-pending.jpg) |
| Staff opening participant-owned `/result` | Report access denied | Verified in browser |
| MANAGER completed report | Stored all-four tie and all 12 candidates visible | [Manager](manager-report.jpg) |

Real PostgreSQL integration tests additionally verify both staff roles, anonymous/foreign access, ignored foreign participant query IDs, nonexistent reports, no-store API responses and unchanged old-version snapshots. Completed integration fixtures have zero Answer rows to establish that reporting does not require or recompute answers.

## Automated checks

| Command | Result |
| --- | --- |
| `npm test` | Exit 0: 74 reference + 109 API + 10 report-render tests = 193 passed; 0 failed/skipped |
| `npm run test:integration` | Exit 0: 35 real PostgreSQL/HTTP tests (12 access + 14 assessment + 9 reports); 0 failed/skipped |
| `npm run test:built` | Exit 0: 3 passed; 0 failed/skipped |
| `npm run lint` | Exit 0; no errors/warnings |
| `npm run typecheck` | Exit 0; API, web, reference and report tests |
| `npm run db:validate` | Exit 0; Prisma schema valid |
| `npm run build` | Exit 0; API packaging and optimized Next.js build, including dynamic participant/staff report routes |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | Exit 0; manifests and lockfile agree |
| `git diff --check` | Exit 0; only existing LF/CRLF conversion notices |

**231 tests passed across the three test commands.** PostgreSQL suites create/drop only their own random test schemas. No dependency, scoring algorithm, database model or migration was added for Phase 5.
