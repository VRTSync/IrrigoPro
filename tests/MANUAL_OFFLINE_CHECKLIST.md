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

