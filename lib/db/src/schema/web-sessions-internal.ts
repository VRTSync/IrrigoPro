// connect-pg-simple session store table declaration.
//
// Declared here (separate from schema.ts + barrel exports) so Drizzle Kit
// recognizes the runtime-created table and doesn't propose to drop it on
// schema sync. Owned by express-session via connect-pg-simple in app.ts
// (createTableIfMissing: true).
//
// IMPORTANT: This file is intentionally NOT re-exported from
// lib/db/src/schema/index.ts or lib/db/src/index.ts. It is only included
// in drizzle.config.ts for Drizzle Kit's schema diff engine. App code
// should never import this table — use the session store directly via
// express-session.
import { pgTable, timestamp, json, varchar, index } from "drizzle-orm/pg-core";

export const webSessions = pgTable("web_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (t) => ({
  expireIdx: index("IDX_web_sessions_expire").on(t.expire),
}));
