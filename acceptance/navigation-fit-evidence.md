# Navigation fit fixes: browser evidence

Measured the real IrrigoPro pages in Chromium with synthetic company-admin session and API responses. The before and after captures use the same data, viewport widths, and navigation settings. This is a layout check, not a live authentication or production-data check.

## Before and after

Measurements are `scrollWidth / clientWidth` in CSS pixels. The Users table is intentionally hidden in the after capture; the measurement is of the visible card list instead.

| Page and viewport | Before | After | Screenshots |
| --- | ---: | ---: | --- |
| Wet Checks, 390 px — chip strip | 665 / 236 | 236 / 236 | [Before](navigation-fit/before-wet-checks-390.jpg) · [After](navigation-fit/after-wet-checks-390.jpg) |
| Wet Checks, 1024 px — chip strip | 665 / 455 | 455 / 455 | [Before](navigation-fit/before-wet-checks-1024.jpg) · [After](navigation-fit/after-wet-checks-1024.jpg) |
| Users, 1024 px — table → cards | 893 / 584 | 628 / 628 | [Before](navigation-fit/before-users-1024.jpg) · [After](navigation-fit/after-users-1024.jpg) |
| Material Markup, 390 px — current tier table wrapper | 407 / 314 | 314 / 314 | [Before](navigation-fit/before-markup-390.jpg) · [After](navigation-fit/after-markup-390.jpg) |

## Width checks

- **Wet Checks:** At 360, 390, 820, 1024, 1366, and 1920 px, all five chips and the More filters button fit without horizontal scrolling. The same page contained both service and inspection records. The chips used multiple lines at narrow widths and a single line at 1366 and 1920 px. The More filters panel also fit when opened at 360 and 390 px.
- **Users:** At 1024, 1200, 1280, 1366, and 1920 px, neither the page nor its visible list scrolled sideways, with the Pages menu open and closed. Slice 7 was not in this checkout: the 76 px column uses the real rail; the 216 px column uses a browser-only width override on that rail. The table was visible and measured **816 / 816** at exactly **860 px** of page content; the card list was visible at **859 px**. All existing columns and actions remain in the table.
- **Material Markup:** The current schedule fit at all six audit widths. At 360 and 390 px all four columns fit in the current schedule, new schedule dialog, and history detail dialog. The smallest editable input measured **74 px** at 360 px and **85.2 px** at 390 px. A keyboard edit to the upper bound updated the next tier's displayed lower bound at both widths, without saving.

Users page content width and visible view with the Pages menu open:

| Viewport | 76 px rail | 216 px rail fixture |
| ---: | --- | --- |
| 1024 | 628 px · cards | 488 px · cards |
| 1200 | 764 px · cards | 624 px · cards |
| 1280 | 844 px · cards | 704 px · cards |
| 1366 | 930 px · table | 790 px · cards |
| 1920 | 1484 px · table | 1344 px · table |

The browser checks compared the document, main column, and affected element's scroll and client widths, and checked for visible inner horizontal scroll containers.
