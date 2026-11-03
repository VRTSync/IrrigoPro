#2101 - Guard Single Customer Routes
What & Why
Implement Customer Records Slice 2a as one self-contained change: apply a shared authenticated-company guard to every single-customer route enumerated in the attached specification, make company and QuickBooks identifiers server-owned, and retire the broken customer CSV import. This closes cross-company reads and writes without changing the customer interface.

The attachment is the detailed implementation and acceptance contract, including its exact middleware order, response text, schema definitions, guard behavior, route inventory, test matrix, and retirement response. Follow it without pulling in Slice 2b or later slices. Slice 1 is merged and its company-scoped QuickBooks lookup is present in this checkout; preserve that implementation. The broader saved customer-records plan supplies context only where it does not conflict with the narrower attachment.

Done looks like
All 12 specified single-customer route registrations use the same guard: GET detail, billing, estimates, work orders and billing sheets; PUT/PATCH detail; PATCH labor rates; DELETE detail; and GET/PUT/DELETE property boundary. Authentication precedes the guard, and existing role middleware keeps its specified position.
The guard validates positive integer IDs with HTTP 400 Invalid customer ID, loads the customer once, and uses only authenticated role/company fields. Missing and foreign customers both return HTTP 404 Customer not found; a super admin may access any company's customer. Null-company non-super-admin callers cannot access customers. Raw role/company headers cannot bypass the guard.
Denied cross-company access emits the specified audit warning. Successful guard calls attach the loaded customer to the request; storage failures return HTTP 500 Failed to load customer.
Customer creation derives company ID from authenticated context and ignores a body-supplied company ID. A caller without company association receives HTTP 403 Forbidden: user has no company association. POST never writes a body QuickBooks ID; PUT/PATCH silently drop both company and QuickBooks IDs. Legitimate editable fields and existing billing-notes/budget behavior remain unchanged.
The shadowed GET detail registration and header-reading property-boundary helper are removed. Customer DELETE explicitly requires authentication, company-admin access and the tenant guard.
Customer CSV import retains its existing route and middleware but returns HTTP 410 with the attachment's exact retirement message and performs no writes. The orphan uploader is deleted, with no other web changes and no changes to irrigation-profile CSV import.
The database-free guard test suite covers the attachment's full ten-case behavioral matrix, route-registration static checks and exported-schema stripping tests. Existing authentication coverage, including Part 8, passes unchanged. New coverage is registered as customer-tenant-guard in the existing serial billing validation lane, with no new workflow.
Acceptance evidence includes both requested validation lanes, the exact clean grep from the attachment, development customer-profile/edit/labor-rate/property-boundary 200s, customer creation under the authenticated company, an authenticated foreign-customer 404, and customer-import 410. Any unavailable evidence is identified explicitly rather than claimed complete. The newest implementation commit describes this diff accurately.
Out of scope
Slice 2b: shared modal, customer form changes, picker changes, or any client changes except deleting the orphan CSV uploader.
Site-map routes, customer-list route, irrigation-profile CSV import, or unrelated customer endpoints outside the attachment's enumerated scope.
Customer records lock, field mapping, review/linking workflows, scheduled pull, QuickBooks writes, migrations, production data repair, publishing, or any later slice.
Redesigning existing role permissions, removing customer deletion, or changing billing-note visibility, budget processing, and labor-rate business rules.
Steps
Implement the shared tenant guard — Add the injectable guard and request augmentation exactly as specified, including positive-integer validation, authenticated-context-only checks, super-admin behavior, customer attachment, audit warning and error handling. Match the existing testable guard pattern without importing the large route registration module into behavioral tests.
Protect every enumerated route together — Wire one guard instance into the route registrations and extracted customer-route dependencies with the attachment's middleware order. Reuse the attached customer where specified, remove the shadowed GET and old boundary helper, and add the missing DELETE authentication while preserving all other handler behavior.
Enforce identifier ownership and retire CSV — Export the specified create/update schemas, set creation company from authenticated context, and silently strip server-owned body fields. Replace only the customer-import handler body with its exact 410 response while retaining middleware, and delete only the orphan customer CSV component.
Add bounded regression coverage — Implement the full in-memory guard matrix, source-registration checks and exported-schema tests from the attachment, including spoofed-header rejection and exactly one denial audit line. Add the new test entry to the existing billing lane and retain the existing authentication coverage unchanged.
Validate and collect acceptance evidence — Run the billing and types validation lanes and the specified clean grep, then perform all attachment development checks with authenticated sessions and capture actual status/results without exposing credentials. Use a second development company and customer only if needed to prove isolation, report any blocked checks honestly, and finish with a scope-matching commit and evidence summary.
Relevant files
attached_assets/Pasted--FIX-Customer-Records-Slice-2a-Customer-Routes-Check-th_1793735627583.txt
docs/customer-records-plan.md
artifacts/api-server/src/routes/customer-routes.ts
artifacts/api-server/src/routes/routes.ts
artifacts/api-server/src/types/express.d.ts
artifacts/api-server/src/routes/billing-sheet-tenant-guard.ts
artifacts/api-server/src/routes/billing-sheet-tenant-guard.test.ts
artifacts/api-server/src/routes/auth-middleware-coverage.test.ts
artifacts/api-server/src/storage.ts:2649
artifacts/irrigopro/src/components/customer-csv-upload.tsx
scripts/validation-lanes.json
scripts/run-validation-lane.mjs
Dependencies

Customer Records Slice 1: Tenant-safe QuickBooks lookups