# Desktop navigation rail and pages panel

## Browser acceptance

Measured the actual Work Orders and Invoices pages in Chromium using synthetic session and API responses. This checks layout and interactions, not live authentication or authorization.

Each desktop measurement used a 768 px viewport height. Invoice rows were expanded with a long ticket description. In all 24 measured views, the document and main column had no horizontal overflow and no visible inner element had horizontal scrolling. The rail had no vertical overflow.

| Role and page | Widths | Panel states |
| --- | --- | --- |
| Company admin — Work Orders | 1024, 1366, 1920 px | Open and closed at each width |
| Company admin — Invoices | 1024, 1366, 1920 px | Open and closed at each width |
| Bookkeeper — Invoices | 1024, 1366, 1920 px | Hidden: Billing is a single-page section |
| Both roles on the pages above | 360, 390, 820 px | Phone navigation; no desktop rail or panel |

The rail measured 76 px. The open panel measured 240 px at 1024 px (no page descriptions), and 280 px at 1366 and 1920 px (page descriptions shown). The right edge measured 2 px in `#1e5c99`, with an inset-only shadow. Pinning and hiding the panel persisted across browser reloads. Ctrl+B was ignored in the Work Orders search input and toggled the panel outside it.

The browser evidence gallery includes all 15 desktop captures and the supplied B2 mockup beside the implemented Work Orders view at 1366 px. The panel follows the mockup's text-only rows, solid count pills, compact section header, and white surface with an inward blue edge. The app uses its real IrrigoPro mark, configured role destinations, live badge sources, and the written 1024 px breakpoint rather than the mockup's placeholder mark, role picker, demo counts, or phone breakpoint. Jump To and the dashboard remain out of scope.

Screenshots and raw measurements are in `generated-artifacts/nav-slice3/`.

## Sidebar removal proof

Before deletion, a workspace-wide basename scan found the IrrigoPro shell import, the sidebar's own mobile-hook import, and the overflow test that read the sidebar source. The other source hits were separate copies in the mockup sandbox, standalone marketing site, and migration backup. None referenced IrrigoPro's sidebar or hook.

```text
artifacts/irrigopro/src/components/layout/desktop-shell.tsx: import from "@/components/ui/sidebar"
artifacts/irrigopro/src/components/layout/shell-overflow.test.ts: reads "src/components/ui/sidebar.tsx"
artifacts/irrigopro/src/components/ui/sidebar.tsx: imports "@/hooks/use-mobile"
```

The post-removal scan returned no matches:

```sh
rg -n 'SidebarProvider|SidebarInset|sidebar-brand-blue|useIsMobile|irrigopro_desktop_sidebar_open' artifacts/irrigopro/src
```

## Automated checks

- Layout and navigation: 229 tests passed in 13 files, including the real role-router parity suite.
- Web app TypeScript check and validation manifest guard passed.
- The current account menu still has My Account and Logout. This branch already retired Switch User; the rail does not restore it.
