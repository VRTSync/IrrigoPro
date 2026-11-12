# Material markup: approved two-step Publish

The user approved this staged rollout after Publish validation tried to add
`markup_override_customer_tenant_fk` before its required key on `customers`.
No production SQL is run by this procedure; both stages use the normal Publish UI.
Never truncate customers, overwrite production data, add deployment/startup DDL,
or remove the existing customer primary key.

## First publish

- Keep `customers_company_identity` and `markup_schedule_company_identity`.
- Temporarily omit only `markup_override_customer_tenant_fk` from the Drizzle
  source and development database.
- Keep the ordinary customer foreign key, schedule/company composite foreign
  key, override uniqueness, and application customer/company ownership checks.
- Verify that the recomputed Publish diff adds the customer unique key, omits
  the deferred foreign key, and has no table/column drops or truncations.
- Ask the user to retry Publish. If prompted about the customer unique key,
  choose to add it **without truncating**. Do not overwrite production data.

This is a temporary reduction in database-level customer/company enforcement,
not the final design. Application writes still validate both customer ownership
and schedule ownership. Do not treat this first stage as the completed rollout.

## After the user confirms the first publish succeeded

1. Verify `customers_company_identity` on production using read-only queries.
   Also read-check overrides for mismatched/missing customers; do not repair
   production rows as part of this procedure.
2. Restore the following entry in the override table's constraint declaration:

   ```ts
   customerTenant: foreignKey({
     name: "markup_override_customer_tenant_fk",
     columns: [t.companyId, t.customerId],
     foreignColumns: [customers.companyId, customers.id],
   }),
   ```

3. Remove the temporary staging comment. Restore the direct database
   cross-company customer rejection assertion in the markup storage tests,
   while retaining the application-boundary and schedule-FK tests.
4. Apply through the normal development schema push, verify the constraint
   exists and is validated, and rerun the targeted storage/route tests.
5. Recompute the development-to-production diff. The customer key must already
   exist on production, so adding the restored foreign key no longer depends
   on a later statement. Review any unrelated changes separately.
6. Ask the user to Publish a second time and verify both production constraints
   read-only afterward.

Do not restore the development foreign key before the first publish: Publish
introspects the development database, so that would reproduce the original
dependency-order failure.
