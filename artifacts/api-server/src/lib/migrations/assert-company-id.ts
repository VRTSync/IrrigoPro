// Slice 4a transitional helper.
//
// During the window when companyId is nullable in schema.ts but the
// database has the column set to NOT NULL (after the admin migration
// runs), TypeScript treats reads as `number | null` while the runtime
// guarantees `number`. Handlers that already passed the
// requireSameCompanyAsWorkOrder / requireSameCompanyAsBillingSheet
// guards have a confirmed non-null companyId; this helper asserts
// that for TypeScript.
//
// Slice 4b removes this helper when schema.ts is flipped back to
// .notNull().

export function assertCompanyId<T extends { companyId: number | null | undefined }>(
  row: T,
  context: string,
): asserts row is T & { companyId: number } {
  if (row.companyId == null) {
    throw new Error(
      `[migration-transition] Row missing companyId at ${context}. ` +
      `Run the company-id-columns-v1 migration from /admin/migrations.`,
    );
  }
}
