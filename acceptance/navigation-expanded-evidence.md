# Expandable desktop navigation

## Browser fit

Chromium opened the actual web app and role routers with synthetic sessions and
populated API fixtures, not live accounts or customer data. Both saved menu
preferences were measured at **1024, 1200, 1366, and 1920 px** with a 768 px
viewport height. All 64 views fit: the document and main column had no
horizontal overflow, and no visible inner scroll container scrolled sideways.

| Role | Pages measured | Views |
| --- | --- | ---: |
| Company admin | `/`, `/work-orders`, `/invoices`, `/customers`, `/estimates/command-center` | 40 |
| Bookkeeper | `/`, `/invoices`, `/customers` | 24 |

The rail measured 76 px collapsed and 216 px expanded. A saved expansion
still measured 76 px at 1024 px and was restored on returning to 1200 px.
Multi-page company admin sections retained their pages menu (240 px at
1024 px, 280 px from 1200 px). The single-page bookkeeper sections and both
dashboards correctly had no pages menu. Ctrl+B left Work Orders selected in
the pages menu; it did nothing below 1200 px and in the search input. The wide
rail's bottom button collapsed the rail, and the phone view stayed independent
of the preference.

The four Work Orders screenshots (1200 and 1366 px, collapsed and expanded)
are in the task's **Work Orders: collapsed and expanded main menu** gallery.
The named B2 mockup was not available in the task workspace, so the gallery
shows the implementation against the written requirements, not a
side-by-side mockup comparison.

## Source and automated checks

```sh
git grep -n -E 'irrigopro_nav_panel_.*open|export function NavRail|<NavRail' \
  -- artifacts/irrigopro/src/components/layout
```

The scan found two legacy-key references: the removal on shell mount and
its regression test. It also found one `NavRail` definition, one app call
site and one test call site. The pages panel and account menu are each shared
across both rail widths.

- 249 navigation, dashboard and shell tests passed.
- The web app TypeScript check and all nine validation manifest checks passed.
- Dashboard coverage confirms the November empty-budget message and three
  lane counts for a non-empty response, using the existing Action Board key.
