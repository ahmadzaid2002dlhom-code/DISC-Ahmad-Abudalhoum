# Phase 8 hosted evidence — 17 October 2026

Verified prototype: **https://disc-ahmad-web.onrender.com/login**. Express: https://disc-ahmad-api.onrender.com. Both are real Render web services in the owner's confirmed My Workspace, Frankfurt. No paid plan or domain purchase was selected.

## Hosted outcomes

| Gate | Actual result |
| --- | --- |
| Frontend-origin health | PASS: GET /api/health = 200, exact disc-api JSON, Cache-Control: no-store |
| Connected Chrome | PASS: real /login page opened and displayed DISC staff login |
| Incognito browser flow | PASS: one hosted Playwright test, 35.6 seconds, zero failed/skipped; separate staff and participant contexts |
| Secure authentication | PASS: both roles login through frontend; __Host-disc.sid is Secure, HttpOnly, SameSite=Lax, Path=/, no Domain and scoped to frontend hostname |
| Origin protection | PASS: missing/foreign mutation Origins = 403; rejected requests create no participants |
| Invitation GET/POST | PASS: GET leaves INVITED; Start redeems by POST and navigates to clean /assessment |
| Confirmations / resume | PASS: single and DI/ID participants complete all 14 groups through UI keyboard controls, awaited saves, final flush and refresh/Back/resume |
| SINGLE | PASS: DI, D/I/S/C = 56/42/28/14, exact N slogan المقنع |
| TIED | PASS: DI/ID, scores 49/49/28/14, null profileCode, shared first rank, exact المقنع / الملهم |
| All-four tie | PASS: 14 API confirmations, scores 35 each, all 12 candidate codes and exact N source slogans rendered; COMPLETED |
| Reports and isolation | PASS: own result cannot be switched by participantId query; foreign staff report and manager access = 403; staff full reports equal stored participant snapshots |
| Stored completion | PASS: repeat submit returns identical saved result; late answer edit = 409; completed invitation redemption returns stored result |
| One principal | PASS: independent session switching staff→participant revokes the previous role; other browser contexts remain independent |
| Manager cohort | PASS: N=3, K=3, P=0, 100%; DI=1, TIED=2, all other single codes=0; 13 exclusive buckets, sum=3=K; means D/I/S/C = 46.666…/42/30.333…/21 |
| Cache/privacy/mobile | PASS: no-store API and personalized pages; no-referrer; exact public word/candidate allowlists; no browser page errors or 375px horizontal overflow |
| Session/result persistence | PASS: an existing authenticated cookie held only in memory, exact manager summary and three immutable reports survived real API service replacement |

The hosted suite creates only the three fictional Phase 8 QA participants. It does not use direct SQL, alter production tables for fault injection, delete records, or run the disposable local E2E harness against the hosted database. Browser traces, videos and storage-state files are disabled. Screenshots contain no password, session cookie or invitation token.

## Deployment and security evidence

- Node.js **24.21.0** was observed in Render's build/runtime logs; Next.js **16.4.2**, React **19.3.1**, Express **5.3.0**, Prisma **7.10.1**, TypeScript **6.0.3**, PostgreSQL **17**, Playwright **1.64.1**.
- API service: srv-db98o4opd3as73bc6fng. Frontend: srv-db9bqlnavr4c73dfr4c0. Database host resource: dpg-db81crqj9qps73b91130-a; separate logical database disc_prototype_v12.
- Initial API provisioning deploy dep-db9bndlg1s2s7384688g created the separate database, applied the committed migration (including Session) and seeded distinct staff once. Existing Compass data was not migrated or seeded. Normal recurring builds now contain only install and API build; provisioning credentials were cleared.
- API build: npm ci --include=dev && npm run build --workspace @disc/api. Start: npm run start:api, API_HOST=0.0.0.0 and platform PORT=10000.
- Web build: npm ci --include=dev && npm run build --workspace @disc/web. Start: npm run start --workspace @disc/web -- --hostname 0.0.0.0 --port $PORT.
- PRIVATE_SEED_BASE64 is backend-only. Exact seed bytes are fingerprint/contract checked and packaged adjacent to compiled API loader. No seed, database URL, session secret or staff password was configured on the frontend. Original source/reference files remain unchanged and untracked.
- Live pre-auth ingress probe observed 127.0.0.1 with forwarded HTTPS. Production trusts only 127.0.0.1/32, with explicit verification flag. Hosted secure login/redemption and frontend-bound cookie checks then passed through Next's actual rewrite. No unconditional or hop-count proxy trust is used.
- PUBLIC_APP_URL=https://disc-ahmad-web.onrender.com. API_ORIGIN=https://disc-ahmad-api.onrender.com.
- Initial verified app release: d8c98db. Hosted browser flow used frontend deploy dep-db9bqm7avr4c73dfr7g0 and API dep-db9bqn7avr4c73dfrbq0. Persistence replacement dep-db9brunavr4c73dg08c0 reached live; the retained session and reports passed afterward.

## Local checks in this phase

| Check | Result |
| --- | --- |
| npm run lint | PASS, exit 0 |
| npm run typecheck | PASS, exit 0, including hosted tests |
| npm test | PASS, exit 0: 74 reference + 110 API/unit + 18 React-render tests = 202; zero failed/skipped |
| API build | PASS, exit 0; compiled seed packaged |
| npm run test:built | PASS, exit 0: 4 tests, including source-absent secret packaging and corrupt-secret rejection |
| Next production build | PASS, exit 0; personalized routes dynamic |
| Hosted browser | PASS, 1 test, 35.6s |
| Hosted process replacement | PASS, exit 0: existing PostgreSQL session + summary + 3 reports |
| git diff --check | PASS, exit 0 |

The first restricted local test/build attempts encountered sandbox EACCES loopback and EPERM generated-directory errors. Running those checks with the needed local permissions passed; no application change was made to mask those environment restrictions. Phase 7's database concurrency/unit audit remains its historical evidence; its 43 local integration tests were not rerun against production in this phase.

## Hosting limits and rejected alternative

Render free web services can cold-start and share the workspace's free service-hour allowance. The existing free database expires **14 November 2026, approximately 00:55 CET** (13 November 23:55 UTC). It persists across service restarts, but must be upgraded or migrated before expiry for longer use. No paid upgrade was selected.

A Vercel Next production deployment dpl_6h74v7SQSjrvuZyYXyAS9AwhcYe7 reached READY after fixing monorepo installation. Its public HTTPS addresses reset connections in Chrome and direct TLS checks, so it is not represented as the verified prototype URL. The selected and tested frontend is Render. The extra Vercel account gate was removed only after explicit user approval; app roles/invitation access remain enforced.

Evaluator credentials are stored only in the owner's ignored EVALUATOR_ACCESS.local.md. Public instructions: open /login, use facilitator for invitations/full reports, manager for analytics, and an incognito participant window for an invitation. Sharing that ignored credential file is the owner's controlled evaluator handoff.

## Final published application release

Application revision **9a8bac95ee928bfd3a5e26a334e238358f976086** is live on both Render services:

- API deploy **dep-db9btue1egvs73emasdg**, live 17 October 2026 00:20:15 UTC, build/deploy duration approximately 70 seconds.
- Frontend deploy **dep-db9btvfavr4c73dg7gug**, live 17 October 2026 00:20:22 UTC, duration approximately 73 seconds.
- Final HTTPS smoke PASS: root 307 → /login; frontend-origin health 200/no-store; secure facilitator login 200; forbidden manager route 403; foreign mutation Origin 403; private seed and .env URLs 404.
- Connected Chrome followed the real root redirect to the staff login page successfully.
- A second retained-cookie check across this final process replacement PASS: identical staff identity, manager summary and all three immutable reports. This check did not create new participants.
- Provider error-level application log scan returned zero entries for both services. No third-party log drain or continuous monitoring was configured.
- Later evidence-only commits do not alter the deployed application code. Both services use manual deployment, so ordinary documentation pushes do not replace these tested instances.

Phase 8 changed files: scripts/package-api-seed.mjs, scripts/create-hosted-database.mjs, apps/api/test/build/packaged-seed.test.ts, apps/web/src/app/page.tsx, .env.example, .gitignore, package.json and README.md. Added tests/hosted/{README.md,playwright.config.ts,full-flow.spec.ts,run.mjs,persistence.mjs} and this evidence folder with five screenshots. No dependency was added in Phase 8. The local evaluator-access file and production environment file are ignored; a staged-patch scan found none of the generated session/staff/seed secrets before publication.

## Reviewed screenshots

- [Stored single, mobile](hosted-single-mobile.jpg)
- [Stored DI/ID tie, mobile](hosted-tied-mobile.jpg)
- [All twelve source slogans](hosted-all-twelve-slogans.jpg)
- [Staff tied report](hosted-staff-tied-report.jpg)
- [Manager exclusive TIED counts](hosted-manager-exclusive-tied.jpg)
