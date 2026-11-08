# Document System verification storage

Schema migration `lib/db/migrations/0031_document_system.sql` is additive and
idempotent. Schema application adds storage only; it does not confirm old zones,
verify equipment, or create site-documentation records.

## Operator step after publish

Randy runs **Backfill confirmed zone types** (`backfill-zone-type-confirmed-v1`)
from `/admin/migrations` on the deployed server after the schema is available.
Merging does not execute this data repair.

1. Open its preview. Each company shows eligible unconfirmed non-Other zones and
   an informational count of Other zones. Retired history is included.
2. Acknowledge the preview and run the migration.
3. Confirm the fresh preview has zero eligible zones. Other zones stay unchanged
   and require an explicit type choice if they are unconfirmed.

The runner updates each company explicitly, independently re-reads eligibility,
and writes its completion marker with the transaction. It is safe to rerun.
No production data has been changed as part of development.
