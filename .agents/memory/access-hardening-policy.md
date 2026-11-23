---
name: Access Hardening policy
description: Locked company access, account management, and shared-device rules.
---

The Access Hardening design is the authority for company access. Authenticated non-super-admin users must have a company. A resource in another company is indistinguishable from a missing resource. Company admins can manage peers in their own company, but not super admins or their own removal or deactivation.

**Why:** An absent company filter can mean all companies in storage. Tenant isolation must not depend on a caller-supplied company ID or reveal whether another company's records exist.

**How to apply:** Reject missing tenant context at authentication, check ownership before operating on a record, and keep role-assignment ceilings separate from the ability to manage an existing peer. Use one public user shape without secrets or wages. Field techs do not get customer or catalog pricing; irrigation managers retain catalog costs and parts-edit access.

The newer design retires Switch User rather than retaining a second way to sign out. App Health remains the only super-admin impersonation flow. Offline access may use the stored identity if the server is unreachable, but a successful identity check takes precedence. Logout clears user-data caches and preserves the app shell.

**Why:** The browser's stored role is not proof of server identity, and a shared device must not serve a previous user's cached data after logout.

**How to apply:** Follow the retirement slice to remove the existing entries, and do not restore them in later navigation work. Do not repurpose logout or offline fallback to change server identity.
