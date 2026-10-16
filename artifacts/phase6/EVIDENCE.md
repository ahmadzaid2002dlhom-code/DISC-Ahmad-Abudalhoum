# Phase 6 evidence — 16 October 2026

Story: staff login → participant table/invitation form or manager dashboard → same-origin Express APIs → persisted PostgreSQL cohort → stored reports and consistent metrics. All records/accounts shown are fictional. Screenshots came from the optimized Next.js build and compiled Express API using the separate local `disc_phase6_verification` database on PostgreSQL 18.6. No intended user database credentials were configured, and no deployment was performed.

## Six-person fixture

Six participants were invited through the actual API. Four completed all 14 confirmed answers and submission through the actual APIs: SINGLE CD, DI, IS and a DI/ID TIED result. One invitation remained INVITED; one was redeemed to IN_PROGRESS without answers. Totals were read back from real persisted rows, not injected dashboard responses.

| Metric | Verified value |
| --- | --- |
| Total invited N | 6 |
| Completed K | 4, including the tied participant |
| Pending P | 2 |
| Completion | API: `100*4/6`; UI: 66.67% |
| Distribution | CD=1, DI=1, IS=1, TIED=1; all other code categories zero; total 4 |
| Means D/I/S/C | 40.25 / 40.25 / 31.5 / 28 |

[Manager six-person dashboard](manager-six-person.jpg) · [Facilitator six-person table](facilitator-six-person.jpg) · [Linked full tied report](linked-tied-report.jpg)

The tied row visibly retained DI — المقنع and ID — الملهم. Pending rows had dashes, Pending and no full-report link. The completed link opened the stored full report with its equal-score groups, both candidate slogans and four scores.

## Invitation persistence and access

- Anonymous manager page showed Sign in required without data/form.
- FACILITATOR could read the same cohort and was denied analytics: [denied screen](facilitator-manager-denied.jpg).
- The facilitator created “Fictional invitation UI” through the form. Copy reported success; clipboard contents exactly matched the new link (comparison returned true without logging the token).
- Reload retained exactly one new INVITED row and exposed no previous invitation link: [persisted invitation](invitation-persisted.jpg).
- A manager loaded N=7, K=4, P=3, completion 57.14%; distribution stayed CD=1/DI=1/IS=1/TIED=1 and means stayed 40.25/40.25/31.5/28: [updated manager dashboard](manager-after-invitation.jpg).
- Direct SQL readback confirmed these final totals, distribution and means.
- Final browser error log was empty.

At 375×812, document width was 360px; the participant table stayed inside a 294px scroll region around its 880px table. ArrowRight focused/scrolled that region (observed scrollLeft increased from 0), keeping the page within the viewport. [Mobile keyboard table](mobile-participants.jpg). Viewport override was reset and the temporary tab closed.

## Real database boundaries

Eight new PostgreSQL/HTTP tests cover empty, no-completed, six-person, all-tied and all-12-SINGLE cohorts; both-role lists/invitations; manager-only authorization including role revocation; and concurrent completion. Every summary asserts 13 exact categories, distribution sum=K and N=K+P. All-tied fixtures include two-candidate and twelve-candidate results, each counted only once. K=0 returns null means.

The concurrency test uses a real exclusive Result-table lock and observes the HTTP read waiting in `pg_stat_activity`. A new completion commits while that read is blocked. The Repeatable Read response keeps N=6/K=4/P=2 and the old complete table/means; the next request sees K=5/P=1 and DI=2. Count, distribution, means and table all derive from one cohort snapshot.

Integration suites each create/drop their own random schema. Existing reference data, scoring policies, immutable results and migration remain unchanged. Temporary frontend/API/database processes were stopped after verification.

## Final checks

| Command | Actual result |
| --- | --- |
| `npm test` | Exit 0: 74 reference + 109 API + 18 rendering = 201 passed, 0 failed/skipped |
| `npm run test:integration` | Exit 0: 43 passed, 0 failed/skipped |
| `npm run test:built` | Exit 0: 3 passed, 0 failed/skipped |
| `npm run typecheck` | Exit 0: API, web, reference and rendering tests |
| `npm run lint` | Exit 0; no warnings/errors |
| `npm run build` | Exit 0; API packaging and optimized Next build including dynamic `/facilitator` and `/manager` |
| `npm run db:validate` | Exit 0; existing Prisma schema valid |
| Existing migration / explicit QA staff seed | Exit 0 on the separate browser verification database |
| `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` | Exit 0; manifests/lockfile agree |
| `git diff --check` | Exit 0; existing LF/CRLF conversion notices only |

**247 tests passed across the three test commands.** Phase 6 adds 8 database and 8 rendering tests. There are no new packages or schema changes.
