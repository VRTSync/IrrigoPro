import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Two schema files:
  //   1. index.ts    — all app-facing tables (re-exported by lib/db/src/index.ts)
  //   2. web-sessions-internal.ts — session-store table; intentionally NOT
  //      exported through app barrels so app code can't import it accidentally.
  //      Included here only so Drizzle Kit knows the table exists and doesn't
  //      propose to drop it on schema sync.
  schema: [
    path.join(__dirname, "./src/schema/index.ts"),
    path.join(__dirname, "./src/schema/web-sessions-internal.ts"),
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
