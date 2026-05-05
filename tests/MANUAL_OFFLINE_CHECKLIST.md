# Manual Offline Verification Checklist

This file tracks the by-hand checks that complement the automated tests for
Slice 4 (Offline Support for Field Wet Checks). Each sub-slice appends its
own section; do **not** delete prior sections — the cumulative checklist is
what we run before flipping a feature flag on for production.

---

## Slice 4A — Service Worker + Read Cache

Goal: a field tech can launch the app with no network signal and see the
last cached parts catalog, issue type configs, property controllers, and
the most recently opened wet check. No writes are exercised here — that
arrives in 4B.

### Setup

1. Build the app with the offline flag on (default):
   `OFFLINE_SERVICE_WORKER=true npm run build && npm start`
2. Sign in as a **field tech** user on the device under test.

### iOS Safari (iPhone, latest two majors)

- [ ] First load registers the service worker (DevTools → Application →
      Service Workers shows the worker as "activated and is running").
- [ ] Open the wet check list, then open one wet check detail screen.
      Confirm `GET /api/wet-checks/:id`, `GET /api/parts/field-tech`,
      `GET /api/wet-checks/issue-types`, and the per-customer
      `GET /api/properties/:customerId/controllers` show 200s.
- [ ] Add the app to the Home Screen ("Share" → "Add to Home Screen").
- [ ] Enable Airplane Mode.
- [ ] Launch the app from the Home Screen — the app shell loads, the
      bottom navigation works, and tapping the previously-opened wet
      check renders from cache (zones, findings, photos that were
      visible online appear; thumbnails may show broken if the photo
      proxy was never warmed — that is expected, photos arrive in 4C).
- [ ] Tap into the parts list; cached parts appear.
- [ ] Disable Airplane Mode and reload — fresh data replaces cached
      data (confirm via a deliberate edit done on another device).

### Android Chrome (latest stable, Pixel- or Samsung-class)

- [ ] First load registers the service worker (chrome://inspect → service
      workers shows the worker as "activated").
- [ ] Open the same screens listed above so the runtime caches warm up.
- [ ] Add the app to the Home Screen via the install banner.
- [ ] Enable Airplane Mode.
- [ ] Launch the app from the Home Screen — app shell loads, navigation
      works, the cached wet check renders.
- [ ] Disable Airplane Mode; the next interaction shows fresh data.

### Update prompt

- [ ] Deploy a new build (or bump the SW manually). On the next page
      load the field tech sees a non-blocking toast: **"New version
      available — Reload"**. Tapping Reload applies the new SW and
      reloads. Dismissing leaves the tech in their current session.
- [ ] Manager / admin users **do not** see the prompt — it only mounts
      under the field-tech layout.

### Feature-flag rollback

- [ ] Build with `OFFLINE_SERVICE_WORKER=false` (or set
      `VITE_OFFLINE_SERVICE_WORKER=false` at build time). Reload an
      installed app: any previously registered SW is unregistered and
      the workbox caches are cleared. Subsequent reloads behave like a
      vanilla SPA (no offline launch).

### Heartbeat endpoint

- [ ] `curl https://<host>/api/health` returns `{ "ok": true }` with no
      auth required. This is what 4B's sync engine will poll.


---

## Slice 4D — Sync UI and conflict handling

Goal: a field tech using the wet check screen can always tell at a
glance whether their work has synced, see exactly what's queued, retry
or cancel anything that failed, and notice when the server kept a
different version because someone else got there first.

### Setup

1. Build with the offline flags on (defaults):
   `npm run build && npm start`
2. Sign in as a **field tech** user on the device under test.
3. Open a wet check from the list to land on the detail screen.

### Header sync badge

- [ ] When everything has drained, the badge in the header reads
      **"All synced"** with a green check icon.
- [ ] Toggle the device offline (Airplane Mode) and add a finding —
      the badge flips to **"Syncing… N"** with the spinner and the
      pending count grows as you tap more buttons.
- [ ] Force a 4xx (e.g. delete a finding twice in offline → online
      → offline → online) — the badge flips to **"Sync errors (N)"**
      in red. Tapping the badge in any of the three states opens the
      queue view.

### Queue view (bottom sheet)

- [ ] The sheet groups entries into **Failed**, **Syncing**, and
      **Recently completed** sections with counts and timestamps.
- [ ] **Cancel** on a pending or failed entry removes it from the
      queue and the badge counters update immediately.
- [ ] **Cancel** on an in-flight entry aborts the network call and
      removes the entry; no further attempts happen.
- [ ] **Retry** on a failed entry resets it to pending; once back
      online it dispatches and moves to Recently completed.
- [ ] With nothing queued the sheet shows
      **"No queued changes — everything is in sync."**

### Offline strip

- [ ] Going offline pins the amber strip to the very top of the
      wet check screen reading **"Offline — your changes are queued
      and will sync when you're back online."**
- [ ] Coming back online removes the strip without a reload.

### 409 conflict toast

- [ ] Set up a finding edit on Device A while another user edits the
      same finding on Device B and saves first. When Device A reconnects
      the engine emits a 409. The toast reads
      **"Someone else changed this first"**, is non-blocking (does
      not block tapping anywhere on the screen), and includes a
      **"View what they did"** action that navigates to the wet check
      and shows the server-wins mirror.
- [ ] Each conflict toasts only once per mutation id (no duplicate
      pop-ups while the engine continues to drain).

### Per-photo upload progress

- [ ] Add several photos while still online — the chip near the badge
      reads **"Uploading photo N of M…"** and the count drops as each
      photo.link mutation completes.

### Feature-flag rollback

- [ ] Build with `VITE_OFFLINE_SYNC_UI=false`. Reload the app: the
      badge, queue view, offline strip, photo progress chip, and
      conflict toasts are all hidden, but the engine continues to
      drain in the background (verified via DevTools → Application →
      IndexedDB → `irrigopro-offline-v2` → `mutationQueue` shrinking
      while online).
