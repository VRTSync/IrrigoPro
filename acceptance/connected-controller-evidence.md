# Connected controller browser acceptance

- Named fixture: **Villas at the Boulders was not present**; equivalent isolated DEV company/customer fixture used with `DEV ONLY` location suffix.
- Fresh company_admin and field_tech users were seeded with bcrypt hashes and `email_verified=true`; both used visible UI login in separate browser contexts. No session bypass.
- Checked `/customers/:id/irrigation-profile` and `/customers/:id/profile` → Irrigation System tab.
- Initial preview interruption: first attempt encountered 502 because preview processes were stopped. After restart, login and all acceptance checks below completed.
- Fixture cleanup ran in `finally`; no customer/company/user fixture rows remain.

## Results
- **PASS** Isolated DEV fixture seeded: Controller C with 18 active zones, Zone17 Rotor, Zone18 Front Lawn, placeholders, attention row, attributed retired row, DEV-only location suffix
- **PASS** company_admin real UI login: Submitted credentials through the visible login form in a dedicated context
- **PASS** Irrigation profile totals and chips: 18 chips, {"set-up":2,"placeholder":15,"attention":1}; Zone17 tooltip “Zone 17 · Rotor · Rotor”
- **SAVED** Screenshot connected-controller-profile-initial.jpg
- **PASS** Zone17 chip editor: Name editor exact value Rotor; focus, scroll into view, and highlight verified
- **SAVED** Screenshot connected-controller-zone17-editor.jpg
- **PASS** Zone17 editor does not reopen after collapse/re-expand
- **PASS** Expanded manager stepper: Increment and decrement controls present
- **PASS** Retire Cancel is read-only: No zone-count PUT request after Cancel
- **PASS** Confirmed retirement and attributed read-only list: 17 active table rows; Zone18 attributed to Acceptance Company Admin; existing retired Zone19 also listed
- **SAVED** Screenshot connected-controller-retired-attribution.jpg
- **PASS** Increment restores same zone ID and focuses Name: Original ID 1350 restored with Front Lawn editor focused
- **SAVED** Screenshot connected-controller-restored-zone-editor.jpg
- **PASS** Customer profile Irrigation System tab · company_admin: Controller C card and 18-zone count visible
- **SAVED** Screenshot connected-controller-customer-profile-manager.jpg
- **PASS** field_tech real UI login: Submitted credentials through the visible login form in a dedicated context
- **PASS** Customer profile Irrigation System tab · field_tech: Add Zone enabled; count stepper/retire controls absent
- **SAVED** Screenshot connected-controller-customer-profile-field-tech.jpg
- **PASS** Irrigation profile field_tech: Add Zone enabled; count stepper absent
- **PASS** DEV fixture cleanup: Removed controller zones/history/program, controller, customer, both users, company

## HTTP 403 responses
- company_admin: none observed
- field_tech: two `403 /api/company/647/profile` responses during profile navigation.
- These were unrelated to irrigation-profile access: the company-profile endpoint explicitly allows only `company_admin` and `irrigation_manager`; the field-tech role correctly receives the route's access-denied response while irrigation controller data, profile content, and Add Zone remained usable. No irrigation endpoint returned 403.

## Other HTTP errors
- company_admin: none observed
- field_tech: the two expected company-profile 403s above; no other HTTP errors observed.


## Browser errors
- Both roles: blocked external `https://replit.com/public/js/replit-dev-banner.js` requests (`net::ERR_BLOCKED_BY_ORB`); no impact to page rendering.
- field_tech: two console 403 notices correspond to the expected unrelated company-profile GET restriction above.


## Screenshots
- connected-controller-customer-profile-field-tech.jpg
- connected-controller-customer-profile-manager.jpg
- connected-controller-preview-unavailable.jpg
- connected-controller-profile-initial.jpg
- connected-controller-restored-zone-editor.jpg
- connected-controller-retired-attribution.jpg
- connected-controller-zone17-editor.jpg
