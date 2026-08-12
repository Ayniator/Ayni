# Mobile shells (F88/F89, Epic E12)

Native Android and iOS apps for AHA, built with [Capacitor 7](https://capacitorjs.com/).
Everything lives in the top-level `mobile/` directory; the `frontend/` web app is
untouched.

- **App ID:** `org.a13z.aha`
- **App name:** AHA
- **Scaffold:** `mobile/android/` and `mobile/ios/` are committed to the repo.
  `mobile/node_modules/`, Gradle caches, Pods, and build outputs are gitignored
  (see the mobile section at the bottom of the root `.gitignore`).

## Architecture — v1: remote-load WebView

The v1 native app is a thin shell. Its WebView loads the deployed web app:

```
server: { url: "https://aha.a13z.org:8443", cleartext: false }
```

(`mobile/capacitor.config.ts`)

**What this buys us:** every web feature ships on mobile on day one — circles,
daily reflections, documents/IPFS, the ZK flows, and the embedded **AHA Wallet**
being built in parallel. The wallet and all app logic come from the web app;
there is no mobile-specific feature code to keep in sync, and a web deploy
updates the installed mobile apps instantly.

**The tradeoff (accepted for v1):** the app requires network connectivity to
load. `mobile/www/index.html` is only an offline placeholder ("Connecting to
AHA…") that appears if the server is unreachable — it is not the app.

**v2 roadmap:**

- Bundle the frontend as a static export into `webDir` and drop `server.url`
  (offline-capable shell, store-reviewable content in the binary).
- Native deep links (App Links / Universal Links for `aha.a13z.org`).
- Push notifications.

## Building in CI (no local SDKs needed)

The workflow `.github/workflows/mobile.yml` (**"Mobile builds"**) is
**manual-trigger only** (`workflow_dispatch`) — it never runs on push or PR.

Run it: GitHub → **Actions** → **Mobile builds** → **Run workflow** → pick the
branch → **Run workflow**. Or from a machine with `gh`:

```sh
gh workflow run mobile.yml --ref solana
gh run watch          # follow it
gh run download       # fetch artifacts when done
```

### Jobs and artifacts

| Job | Runner | Artifact name | Contents |
|-----|--------|---------------|----------|
| `android` | ubuntu-latest (JDK 21 + Android SDK) | `aha-android-debug-apk` | `app-debug.apk` (debug-signed, installable) |
| `android` | " | `aha-android-release-unsigned-apk` | `app-release-unsigned.apk` (needs signing before install/store) |
| `ios` | macos-latest (Xcode) | `aha-ios-xcarchive-unsigned` | `App.xcarchive.zip` (unsigned archive; export an IPA with your signing identity) |

Both jobs run `npm ci` in `mobile/` and `npx cap sync <platform>` before
building, which regenerates the gitignored synced files
(`assets/public/`, `capacitor.config.json`, Pods).

### Installing the Android APK artifact

1. Download `aha-android-debug-apk` from the workflow run page and unzip it.
2. Copy `app-debug.apk` to the phone (or use `adb install app-debug.apk` with
   USB debugging enabled).
3. On-device, allow "Install unknown apps" for your file manager/browser when
   prompted, then open the APK.

The debug APK is signed with the standard Android debug key — fine for testing,
never for the Play Store. The unsigned release APK will not install until it is
signed (`apksigner sign --ks <your-keystore> app-release-unsigned.apk`).

## Store submission checklist

Signing credentials are the **user's own** and are **never stored in this
repository** (no keystores, no Apple certificates, no API keys in git or in
workflow files). When the time comes, add them as GitHub Actions secrets or
sign locally.

### Google Play (Play Console)

- [ ] Play Console account ($25 one-time) with the `org.a13z.aha` app created.
- [ ] Upload keystore: generate once (`keytool -genkeypair`), keep it safe —
      or opt into Play App Signing and let Google hold the release key.
- [ ] Build an `.aab` for the store (`./gradlew bundleRelease`) and sign it.
- [ ] Data safety form: **the app collects nothing.** No analytics, no ads
      SDKs, no server-side data collection by the shell. Geolocation ("Find a
      Circle Near You") is the browser geolocation permission, used locally in
      the WebView and never transmitted to AHA servers as tracking data.
- [ ] Content rating questionnaire, privacy policy URL, store listing assets
      (icon 512px, feature graphic, screenshots).
- [ ] Note for review: the app loads `https://aha.a13z.org:8443` (remote
      content); have a demo account/flow ready if the reviewer asks.

### App Store (App Store Connect)

- [ ] Apple Developer Program membership ($99/yr); register bundle ID
      `org.a13z.aha`, create a distribution certificate + provisioning profile.
- [ ] Export a signed IPA from the CI `App.xcarchive` (Xcode → Organizer →
      Distribute, or `xcodebuild -exportArchive` with your `ExportOptions.plist`),
      upload via Transporter/Xcode.
- [ ] App privacy declaration: **no data collected.** Location is requested via
      the WebView's browser permission, used only on-device to show nearby
      circles; add the `NSLocationWhenInUseUsageDescription` string to
      `ios/App/App/Info.plist` before submission (WKWebView geolocation
      requires it).
- [ ] Be ready for guideline 4.2 (minimum functionality) scrutiny: v1 is a
      remote-loading WebView, which Apple sometimes rejects as "just a
      website". Mitigations: the v2 bundled build, and/or native touches
      (deep links, push). Plan for at least one review round-trip.
- [ ] Store listing: screenshots per device class, description, privacy policy
      URL.

## Local development (machine with SDKs)

```sh
cd mobile
npm ci
npx cap sync            # both platforms; or: npx cap sync android / ios
npx cap open android    # opens Android Studio
npx cap open ios        # opens Xcode (macOS; needs CocoaPods: sudo gem install cocoapods)
```

- Node ≥ 20 is required by the Capacitor 7 CLI.
- Android: build/run from Android Studio, or
  `cd android && ./gradlew assembleDebug`.
- iOS: `npx cap sync ios` runs `pod install`; then build the `App` scheme in
  Xcode. The repo's `ios/` scaffold was generated without CocoaPods present, so
  the first sync on a Mac creates `Pods/` (gitignored).
- After editing `capacitor.config.ts` or `www/`, re-run `npx cap sync`.
