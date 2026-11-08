# Document System read and verify API acceptance

## Scope

Six endpoints only; no wizard UI, changes to legacy irrigation behavior,
deployment, or production repair.

The existing additive migration `0031_document_system.sql` was applied to this
task workspace's development database with explicit user approval after the
merged prerequisite code was fetched. No new migration or backfill was added.

## Authenticated read evidence

Checked through the running managed API workflow and shared proxy using `curl`.
A temporary, isolated company, empty customer, and System Documenter user were
seeded, then authenticated via the real `POST /api/auth/login` session-cookie
flow. No header-auth shortcut or permission bypass was used.

- [x] Login succeeded with the System Documenter role.
- [x] `GET /api/system-documentation/sites` returned HTTP 200.
- [x] Customer keys were exactly `customerId`, `name`, `address`, `branches`,
  and `sites`. No billing/budget fields or private billing-note fixture appeared.
- [x] Reading the empty customer's site returned HTTP 200 and `controllers: []`.
- [x] A subsequent direct database count was **0 controller rows**.
- [x] Its site block was:

```json
{
  "status": "nothing_on_file",
  "verifiedAt": null,
  "verifiedByName": null,
  "noBackflowConfirmed": false
}
```

The temporary records, login audit, session, cookie file, and one-off acceptance
script were removed after the check. No credentials or cookies are retained.

## Automated checks

- Real DB-backed documentation routes, existing irrigation-profile regressions,
  and the real documenter allowlist matrix pass together, serially.
- The new suite is registered in `api-field`; no workflow was added.
- The validation manifest checks pass.
- Shared and API-server typechecks pass, with fresh generated declarations.
- OpenAPI code generation and library declaration build pass.

The existing web sign-in page was also visually checked. No signed-in UI was
added or changed in this slice; authenticated acceptance covered the API.
