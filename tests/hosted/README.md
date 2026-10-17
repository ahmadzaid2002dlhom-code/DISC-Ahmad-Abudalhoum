# Hosted verification

Run from the repository root after deploying the real frontend and API. This suite adds three fictional participants to the shared cohort. It never connects directly to PostgreSQL, changes database schema, injects failures, removes records, or starts services. Existing cohort totals are respected through baseline/delta assertions.

Supply these variables securely in the current process environment (do not commit credentials):

- `HOSTED_BASE_URL`: actual HTTPS frontend origin, without a path.
- `HOSTED_FACILITATOR_EMAIL` and `HOSTED_FACILITATOR_PASSWORD`.
- `HOSTED_MANAGER_EMAIL` and `HOSTED_MANAGER_PASSWORD`.

```sh
node node_modules/@playwright/test/cli.js test --config tests/hosted/playwright.config.ts
```

Chromium must already be installed for the existing Playwright version. The suite uses separate incognito browser contexts and keeps cookies, passwords and invitation tokens in memory. Traces, videos, automatic screenshots and storage-state files are disabled. Five explicit screenshots of completed reports and the dashboard are saved under `artifacts/phase8/`.

Both SINGLE DI and TIED DI/ID participants confirm all 14 groups in the UI with keyboard controls, including refresh/resume. An all-four tie uses 14 real API answer confirmations and then renders all 12 source slogans. API checks cover secure frontend cookies, Origin rejection, ownership and role boundaries, immutable completion, stored results, restored durable sessions and exclusive manager distribution counting.

Cookie restoration in a fresh context proves the session is usable independently of the original browser context. Persistence across an actual API service restart/redeploy must also be checked separately through the hosting provider; the suite does not claim to restart services.

The root convenience command is `npm run test:hosted`. Its runner optionally loads the Git-ignored `.env.production.local` and maps the backend staff seed values to the hosted test variables. It never prints credentials. The app's normal startup does not load that production file.

For process-replacement evidence, run `npm run test:hosted -- --persistence` after there are completed fixture records. When `PERSISTENCE_READY` appears, the script holds its authenticated cookie only in memory. Redeploy the API through authorized hosting access; confirm the new deploy ID is live, then write a non-secret marker to `node_modules/.cache/disc-phase8-restart.complete`. The script checks the same session, exact manager snapshot and every completed report without another login, then removes its temporary marker files. It times out after ten minutes instead of treating a missing restart confirmation as success.

The existing root `npm run typecheck` includes these files through `tsconfig.tests.json`. Targeted checks, without changing shared configuration:

```sh
node node_modules/typescript/bin/tsc --project tsconfig.tests.json
node node_modules/eslint/bin/eslint.js tests/hosted
```
