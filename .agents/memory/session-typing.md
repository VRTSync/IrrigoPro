---
name: express session typing
description: Where custom session fields (userId/companyId/role) must be declared in the api-server
---

# Express session custom fields belong on express-session's SessionData

Custom session fields (`userId`, `companyId`, `role`) must be added by augmenting
`express-session`'s `SessionData` interface, NOT by declaring a `session` property
on `Express.Request`:

```ts
declare module "express-session" {
  interface SessionData {
    userId?: number;
    companyId?: number;
    role?: string;
  }
}
```

**Why:** The api-server depends on both `express-session` and `@types/express-session`.
Those types already declare `req.session: Session & Partial<SessionData>` (which natively
provides `regenerate/save/destroy/reload/touch`). A second manual `session` property
declaration on `Express.Request` collides with that, producing intermittent
"Property 'userId' does not exist on type 'Session & Partial<SessionData>'" errors at
some call sites but not others.

**How to apply:** When you need a new server-side session field, add it to the
`SessionData` augmentation in `artifacts/api-server/src/types/express.d.ts`. Never
re-introduce a hand-written `session: ...` member on the `Express.Request` interface.
