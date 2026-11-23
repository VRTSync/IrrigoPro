# Role Dashboard validation

## Browser evidence

Chromium loaded the actual IrrigoPro web app and role routers with synthetic sessions and API responses. No real customer data was used. The Library asset **Role Dashboard: B2 comparison and screen-size checks** contains full-page screenshots for both roles.

| Width | Tile columns | Company admin tiles | Bookkeeper tiles | Bookkeeper reserved slots | Dashboard width | Horizontal overflow |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 360 px | 1 | 8 | 1 | 0 | 360 px | None |
| 390 px | 1 | 8 | 1 | 0 | 390 px | None |
| 820 px | 2 | 8 | 1 | 7 | 820 px | None |
| 1024 px | 2 | 8 | 1 | 7 | 948 px | None |
| 1366 px | 4 | 8 | 1 | 7 | 1290 px | None |
| 1920 px | 4 | 8 | 1 | 7 | 1844 px | None |

The document, main column, and visible inner scroll containers were measured separately. Desktop Dashboard showed the 76 px rail and no pages panel. The date was 34 px and the quick actions were at least 40 px tall. Both roles could open and close Jump To. Dashboard opened with GET requests only, without triggering payment-status sync.

The gallery compares the supplied B2 HTML mockup with the implementation at 390 and 1366 px for both roles. The app follows the reference's band dividers and typography, tile geometry and fixed slots, and inline preview links with colored row markers. The locked production requirements take precedence over the demo's shortcut labels, sample metrics, and breakpoints.

## Removal scan

Before deleting any file, the workspace was scanned by basename:

```sh
rg -n -i --hidden --glob '!.git/**' --glob '!.local/state/**' \
  --glob '!pnpm-lock.yaml' \
  'admin-dashboard|header-strip|quick-actions|attention-panel|operations-pipeline|activity-feed|top-customers-compact' .
```

The actionable source matches before removal were:

```text
components/company-admin-app.tsx                         imports pages/admin-dashboard
App.unsupported-role.test.tsx                            mocks pages/admin-dashboard
components/layout/nav-route-parity.test.tsx               mocks pages/admin-dashboard
office-page-width.test.ts                                reads pages/admin-dashboard.tsx
pages/admin-dashboard-invoice-count.test.tsx             imports ./admin-dashboard
pages/admin-dashboard-fp-parity.test.tsx                 reads admin-dashboard.tsx
scripts/src/audit-hooks-after-return.ts                   lists pages/admin-dashboard.tsx
pages/admin-dashboard.tsx                                imports header-strip, quick-actions, attention-panel, operations-pipeline, activity-feed and kpi-tile
components/financial-pulse/financial-pulse-widget.tsx     declares and renders both removed variants
components/financial-pulse/financial-pulse-billing-header.test.tsx  renders both removed variants
components/budget/BudgetBar.test.tsx                       renders top-customers-compact
```

The Estimate Command Center still imports `components/admin-dashboard/kpi-tile.tsx`. The unrelated `components/billing-workspace/activity-feed.tsx` and its consumers are unchanged. Historical documentation and server comments do not import the old page.

The post-removal source scan returned no matches:

```sh
rg -n 'pages/admin-dashboard|components/admin-dashboard/(header-strip|quick-actions|attention-panel|operations-pipeline|activity-feed)|admin-dashboard-(invoice-count|fp-parity)|top-customers-compact' \
  artifacts lib scripts --glob '!**/dist/**'
```

## Automated checks

- 247 tests passed across the dashboard, real role routers, unsupported-role handling, office widths, Action Board, Invoices, and remaining Financial Pulse widgets.
- All 16 dashboard API contract tests passed.
- Web TypeScript and the validation manifest checks passed.
