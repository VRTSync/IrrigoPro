---
name: Finding-create paths must link pre-uploaded photos
description: Wet-check finding editors upload photos before the finding exists; every create path must re-link them or they land loose (findingId=NULL).
---

# Finding-create photo linking

In the wet-check flow a tech can attach photos to a finding **before the
finding exists**. Each photo is uploaded with `findingId = null` and tied to
the not-yet-created finding only by a pre-generated `findingClientId`
(the editor's `pendingClientId`). After the finding is created, the client
**must** re-link those photos to the real finding id, or they stay loose on
the server (`findingId = NULL`) and never "stick" to the flag.

**Rule:** every finding-create path must, after create, link the snapshot of
photos where `findingId == null && findingClientId === pendingClientId`.
Two editors implement this and must stay in sync:
- `FindingSheet.tsx` — tracks captured photos in a dedicated `pendingPhotos`
  state array.
- `CustomFindingEditor` (inside `ZoneScreen.tsx`) — has **no** pendingPhotos
  state; it derives them from the `photos` prop by `findingClientId` match.

**Why:** a regression shipped where `CustomFindingEditor` created the finding
but skipped the link step, so every "Custom — Flag for Manager" photo landed
loose in production. The server route ignores `findingClientId` (not in its
Zod body), so linking is purely client-side.

**How to apply:** mirror the three branches — (a) offline + zoneRecordClientId:
`offlineLinkPhotoToFinding` with `findingClientId` only ({{f}} placeholder);
(b) online + offline-enabled: seed `putFindingMirror` then link WITH the real
findingId; (c) fully online: `withRetry` PATCH `/api/wet-checks/photos/:id`
and surface a failure count.

**Offline-disabled caveat:** `PhotoCaptureButton`'s legacy (online-only) path
does NOT stamp `findingClientId` on the optimistic photo. So with the offline
queue rolled back, `CustomFindingEditor`'s photo gate never satisfies and
"Save Flag" can't enable — the online PATCH branch is effectively dead code
today. Production runs with the offline queue enabled, so this is latent, not
active. If the queue is ever disabled, the custom flag editor needs its own
`pendingPhotos` tracking (FindingSheet-style) or a findingClientId stamp on
the legacy capture path.
