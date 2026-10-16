# Phase 7 audit — 16 October 2026

Scope: AGENTS.md and the guide's local QA requirements. No deployment. All participants, accounts and fault-injection controls were fictional and isolated. Production app code was tested through the frontend's actual same-origin rewrite into the compiled Express API and PostgreSQL.

## Final command results

| Command / gate | Result | Evidence |
| --- | --- | --- |
| `npm test` | PASS, exit 0 | 74 reference + 110 API/unit + 18 React rendering = 202 passed, zero failed/skipped |
| `npm run test:integration` | PASS, exit 0 | 43 real PostgreSQL/HTTP tests; zero failed/skipped |
| `npm run test:built` | PASS, exit 0 | 3 isolated compiled-artifact tests; zero failed/skipped |
| `npm run test:e2e` | PASS, exit 0 | 3 Chromium tests; zero failed/skipped, 18.3 seconds |
| `npm run lint` | PASS, exit 0 | No errors/warnings |
| `npm run typecheck` | PASS, exit 0 | API/web/reference/rendering/Playwright tests |
| `npm run build` | PASS, exit 0 | Packaged API and optimized Next build, all personalized routes dynamic |
| `npm run db:validate` | PASS, exit 0 | Existing schema valid |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | PASS, exit 0 | Lockfile agrees with manifests |
| `git diff --check` | PASS, exit 0 | No whitespace errors; existing LF/CRLF notices |
| Production-only npm audit | PASS, exit 0 | Zero vulnerabilities |
| Full npm audit | FAIL, exit 1 | Four high affected development packages, one underlying unpatched braces advisory |
| Git-only availability of original pack inputs | FAIL | `git ls-files` returns no entries for seed/workbook/reference scorer/tests; these original supplied files remain untracked |

**251 tests passed in final runs.** Node 24.19.0, npm 11.17.0, PostgreSQL 18.6, Playwright 1.64.1 and Chromium 156.0.8078.4/revision 1248. Next/React/Express/Prisma versions remain pinned as recorded in README.

## Requirements audit

| Requirement | Outcome and actual evidence |
| --- | --- |
| Source fidelity | PASS: 14 groups, 56 opaque IDs, workbook SHA/cell audit, C/D/S/I mapping, row 1 exclusion, C6/C7 join, both Daring entries, all translations and raw P/Q/R checked by reference/API tests |
| Exact ranking validation | PASS: missing/unknown/extra/duplicate groups and missing/foreign/duplicate word permutations rejected; client identity/points/scores rejected |
| Correct score/tie policy | PASS: 4/3/2/1 by participant order, total 140, dimension ranges 14..56; DI vs ID, DI/ID, DI/DS, lower-only and all-four ties; 1,000 mixed-response oracle comparisons |
| Confirmation / no untouched answers | PASS: invitation GET leaves INVITED with zero answers; 13 confirmations leave 13 rows and disabled Submit; final confirmation creates row 14 |
| Failed saves / resume | PASS: real PostgreSQL trigger rejects the first save and final-group confirmation; browser retains order; retry commits; refresh resumes group 2; Back restores saved group 1 |
| Final flush | PASS: after 14 confirmations, a real failure on final PUT leaves IN_PROGRESS/14 answers/zero results; retry completes |
| Concurrent submission / answer race | PASS: browser submit plus eight concurrent HTTP submits return the same TIED result; exactly one result row. API tests additionally observe actual parent-row lock waiters and both answer-first/submit-first races |
| Immutable stored snapshots | PASS: direct completed-result mutation rejected, late edits return 409, repeat submits return stored content/timestamps; old-version completed reports do not require current seed or answers |
| Sessions and roles | PASS: separate browser contexts initially have separate authentication; facilitator denied analytics, participants denied staff reports; staff→participant switching removes old privileges; database/API tests cover rotations, expiry, failed session saves, logout and restart persistence |
| Caching / Origin / production cookies | PASS locally: personalized browser/API responses are no-store; invalid Origins/JSON rejected; production API integration tests verify trusted HTTPS proxy handling and Secure/HttpOnly/SameSite/Path/no-Domain cookie behavior. Actual hosted proxy chain is untested in this phase |
| SINGLE/TIED reports | PASS: both full UI assessments complete; tied participant remains COMPLETED in DB, `/me`, own result, staff report, staff table and manager cohort |
| Manager cohort | PASS: after SINGLE+TIED, N=2/K=2/P=0, completion 100%, DI=1/TIED=1/ID=0, sum=2; means D/I/S/C=52.5/45.5/28/14. Adding all-four tie gives K=3/TIED=2, sum=3. API tests cover six-person, empty, no-completed, all-tied and all-12-SINGLE cohorts and concurrent snapshot consistency |
| N descriptions | PASS: all 12 candidate cards checked against exact N text in both own and staff reports. Identical name/description rendered once per card; null English accepted. IC/CI remain distinct cards with shared source slogan |
| Keyboard / mobile / drag | PASS: Move Up via Enter and pointer drag operate on the same order, displayed ranks stay 1..4, subsequent saved scores match desired ranking; 375×812 mobile page has no horizontal overflow |
| Production seed packaging | PASS: compiled API runs the full flow; standalone packaged loader succeeds without source checkout and rejects missing/tampered seed; no fallback |
| Browser privacy | PASS: exact word/candidate DTO keys; 18 served JS/CSS assets and six dynamic HTML routes inspected for source fingerprints/metadata/opaque seed IDs/raw provenance and harmless build secret canaries; no matches |
| Obsolete instructions/UI | PASS: code, guide, prompts and report UI inspected; no active long-description blocker, missing-description alert or automatic tie winner. Negative instructions/tests mentioning those terms are intentional |

## Confirmed fix

The previous report serializer returned complete stored candidate objects, including unused raw P/Q/R and source-row provenance. `resultDto` now exports an explicit four-field candidate allowlist: code, exact stored Arabic name/description and nullable English description. Full immutable snapshots remain unchanged in PostgreSQL. All participant/staff/submit/retry/cohort endpoints use this same serializer. A new regression checks all 12 source slogans and storage immutability.

The browser suite initially failed on its own broad DOM selectors/timing: dnd-kit adds an aria-hidden placeholder, and Next adds a separate route-alert region. Tests now inspect accessible word rows, scope application alerts and await each reorder. The original drag component was restored and passes; no application drag/scoring change was retained.

## Dependency and duplicate-code review

No unused direct dependency was identified. React/Next/dnd-kit power the UI; Express/express-session/pg/Prisma and adapter power the API and durable sessions; TypeScript/ESLint/Next lint plugin/concurrently are used by scripts; fast-xml-parser/fflate are used by workbook audits; type packages are consumed by compilation. Playwright is the explicitly authorized new development-only test runner. Uninstalling these would remove required code or checks.

There is one production `scoreAssessment`, under `apps/api/src/domain/`; no frontend scoring implementation/import exists. The included `reference/scoring.ts` and reference tests are deliberately preserved developer inputs and an independent test baseline, not a second application scoring path. Compiled API artifacts are ignored build output.

Full npm audit remains nonzero for `@next/eslint-plugin-next → fast-glob → micromatch → braces`. The four affected development packages represent one underlying [braces advisory, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), which lists no patched version. Registry metadata checked during this run: plugin 16.4.2, micromatch 4.0.8 and braces 3.0.3 remain current and retain the chain. npm proposes a major downgrade of the plugin; no blind downgrade or removal of used lint rules was made. Production audit reports zero vulnerabilities.

Original `data/disc-assessment-seed.json`, workbook and reference tests are still untracked under the earlier generated-files-only commit scope. Local production packaging is verified, but a clean Git-only checkout lacks these build/test inputs. Supply the unchanged original pack or include it in the intended source delivery before a Git-based build/deployment. This phase did not publish those inputs or deploy anything.

## Screenshots

- [Failed first save retains edited mobile order](failed-save-mobile.jpg)
- [Failed final flush stays uncompleted](failed-final-flush.jpg)
- [Stored SINGLE DI, mobile](single-result-mobile.jpg)
- [Stored TIED DI/ID, mobile](tied-result-mobile.jpg)
- [Staff full tied report](staff-tied-report.jpg)
- [Manager counts one SINGLE and one TIED completion](manager-single-tied.jpg)
- [All 12 exact source slogans](all-twelve-source-slogans.jpg)
- [Manager after the third completed participant](manager-three-completions.jpg)

Screenshots were visually inspected. They contain only fictional test records and no passwords, connection strings or invitation tokens. Playwright trace/video recording is disabled; temporary failure diagnostics stay in ignored node_modules/.cache. Each E2E run created/dropped its own fresh `disc_e2e_<random>` database; cleanup check found zero remaining E2E databases. Temporary test services were stopped after verification.
