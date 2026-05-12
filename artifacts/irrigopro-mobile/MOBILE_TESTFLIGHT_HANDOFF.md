# IrrigoPro Mobile — TestFlight & Play Console Handoff (M9)

This is the operator runbook for taking the IrrigoPro mobile app from the
repo state at the end of M9 to a build that the pilot tech can install on
their iPhone (TestFlight) and Android device (Play Console internal track).

Everything below requires accounts and credentials that are intentionally
kept out of the repo. The steps marked **(operator)** must be done by
someone with the matching account access.

## What M9 already wired up in-repo

- `assets/images/{icon,adaptive-icon,splash-icon,favicon}.png` — all four
  pulled from the marketing standalone (`marketing-site-standalone/public/irrigopro-logo.png`)
  so the brand mark matches `irrigopro.com`.
- `app.json` finalised:
  - `ios.bundleIdentifier = com.irrigopro.mobile`
  - `ios.buildNumber = "1"` (EAS will auto-increment for `preview`/`production` builds)
  - `android.package = com.irrigopro.mobile`, `versionCode = 1`
  - `android.adaptiveIcon` + `android.permissions` (Camera, Location, Photos)
  - `scheme = irrigopro` (deep link scheme — used for OAuth-style redirects in future)
  - All iOS permission strings (`NSCameraUsageDescription`,
    `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`,
    `NSLocationWhenInUseUsageDescription`)
  - `ITSAppUsesNonExemptEncryption = false` (the app only uses standard
    HTTPS — no custom crypto — so Apple's encryption export
    questionnaire is satisfied with this single boolean)
  - `extra.eas.projectId` placeholder — `eas init` will fill this in
- `eas.json` with `internal`, `preview`, and `production` profiles for both
  platforms. `internal` builds an `.apk` for sideload + an `internal`-signed
  iOS build; `preview` builds an `.aab` + a store-signed iOS build.
- Polish pass:
  - One shared `lib/toast.ts` (`showToast`, `friendlyErrorMessage`) — no
    more raw `Network request failed` strings reaching field techs.
  - One shared `components/Loading.tsx` (`LoadingScreen`, `LoadingRow`,
    `Skeleton`).
  - Haptics on every submit (sign-in, wet check submit, billing sheet
    create / save / submit, work order start / complete) and on Force
    Resync drain completion (success / warning / error all distinct).

## Operator prerequisites

1. **Apple Developer Program** membership (the company's account, not a
   personal one). Get the **Team ID** from
   <https://developer.apple.com/account>.
2. **App Store Connect** record for `com.irrigopro.mobile`. Create the app
   under "My Apps" → "+" → New App. Note the **App Store Connect App ID**
   (a numeric value).
3. **Google Play Console** account with an app record for
   `com.irrigopro.mobile`. The first build must be uploaded manually so
   the Play Console can register the package. After that, EAS can submit
   to the internal track unattended.
4. An **Expo account** (free) with access to the IrrigoPro org.

## One-time setup (operator)

```bash
# Install the EAS CLI globally.
npm install -g eas-cli

# Authenticate.
eas login

# From the mobile artifact directory:
cd artifacts/irrigopro-mobile

# Create the EAS project record. This rewrites `extra.eas.projectId`
# in app.json with the real id — commit that change.
eas init

# Provision iOS signing assets (distribution cert + provisioning profile).
# Pick "Let EAS handle credentials" when asked.
eas credentials --platform ios

# Provision Android signing (upload key + service account JSON for submit).
eas credentials --platform android
```

Then fill the placeholders in `eas.json`:

- `submit.internal.ios.appleTeamId` → the Apple Team ID
- `submit.internal.ios.ascAppId` → the App Store Connect App ID
- (same for `submit.preview.ios.*`)

## First builds (operator)

```bash
cd artifacts/irrigopro-mobile

# Internal sideloadable builds — fastest way for the pilot tech to try
# the app before TestFlight review clears.
eas build --profile internal --platform ios
eas build --profile internal --platform android

# TestFlight + Play Console internal track builds.
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

Each iOS build takes ~15 minutes; Android builds are faster. EAS posts a
URL when each build is ready.

## Distributing to the pilot tech (operator)

**iOS / TestFlight:**

```bash
eas submit --profile preview --platform ios --latest
```

Then in App Store Connect → TestFlight, add the pilot tech's Apple ID to
the **Internal Testers** group. They install the TestFlight app from the
App Store, accept the invite email, then install IrrigoPro from
TestFlight. No App Store review needed for internal testers.

**Android / Play Console:**

```bash
eas submit --profile preview --platform android --latest
```

In Play Console → Internal Testing, add the pilot tech's Google account
to the testers list and share the opt-in link from the same screen.

## Pilot smoke test checklist

After the pilot tech has the app installed, walk through:

1. **Sign in** with their field-tech account.
2. **Today** screen shows their work orders for today.
3. Open one work order → **Start work** (haptic confirms) → take a wet
   check on a single zone with one finding + one photo → **Submit wet
   check** (haptic + toast).
4. Back on the work order → **Add billing sheet** → enter hours,
   description, parts, capture a photo → **Submit billing sheet** (haptic
   + toast).
5. Confirm both records land in the office web app at
   <https://app.irrigopro.com>.
6. Go offline (airplane mode), make an edit, come back online, and
   verify Force Resync clears the queue.

## Web preview compatibility

`server/serve.js` is the existing zero-dependency static server used by
the Replit dev preview. The M9 changes don't touch it — `app.json` and
the polish pass are pure config / TS, and the server reads `app.json` only
for the page title. The `pnpm --filter @workspace/irrigopro-mobile run
build` + `serve` flow continues to work and is still the way Replit
serves the in-browser preview alongside the native EAS builds.

## Out of scope for M9 (deferred)

- Public App Store / Play Store release — this slice covers internal
  distribution only.
- Push notifications. Expo push tokens are *not* captured at sign-in
  yet; revisit once the pilot signs off on v1.
- Crash reporting / analytics tooling. The bare-minimum `ErrorBoundary`
  + `ErrorFallback` already present in `components/` is what ships.
- Migrating the photo storage prefix on existing wet-check photos
  (separate follow-up).
