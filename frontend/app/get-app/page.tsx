"use client";

// F93 — "Get AHA": how to install the native shell, and what is honestly
// available today.
//
// The page says the awkward thing out loud rather than showing a dead store
// badge: there is no Play Store or App Store listing yet, and the iOS archive
// CI produces is unsigned, so it cannot be installed without your own Apple
// signing identity. Android has a real, installable artifact. Pretending
// otherwise would send people hunting for a button that does not exist.
//
// Content is deliberately English-only for now (the nav label is translated);
// the body is queued for the next i18n pass — see BACKLOG F93.

import { useEffect, useState } from "react";
import { useT } from "../../components/SettingsProvider";
import { Platform, detectPlatform } from "../../lib/platform";

const REPO = "https://github.com/Ayniator/Ayni";
const ACTIONS = `${REPO}/actions/workflows/mobile.yml`;

export default function GetApp() {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("web");
  useEffect(() => setPlatform(detectPlatform()), []);

  return (
    <>
      <h1>{t("getapp.title")}</h1>
      <p className="lede">
        The native app is a thin shell around this same site: everything you can
        do here — your Circle, the wallet, the Steps, the reflections — works
        identically inside it, and a web update reaches the installed app
        immediately. It needs a network connection; there is no offline mode yet.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Where things actually stand</h3>
        <p style={{ marginBottom: 8 }}>
          AHA is <strong>not yet on Google Play or the App Store</strong>. Builds
          come from the project&apos;s own CI, and they are produced on demand
          rather than published continuously. So:
        </p>
        <ul className="sm" style={{ margin: 0 }}>
          <li>
            <strong>Android</strong> — there is a real, installable APK. It is
            debug-signed, which is fine for testing and not for a store.
          </li>
          <li>
            <strong>iPhone / iPad</strong> — there is <strong>no installable
            build yet</strong>. CI produces an unsigned archive, and iOS refuses
            to install anything unsigned; turning it into an app requires an
            Apple Developer account and your own signing identity.
          </li>
        </ul>
      </div>

      {platform !== "ios" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Install on Android</h3>
          <ol className="sm" style={{ margin: 0 }}>
            <li>
              Open the <a href={ACTIONS} target="_blank" rel="noreferrer">Mobile
              builds workflow</a> and pick the most recent successful run. If
              there is none, press <em>Run workflow</em> on the <code>solana</code>{" "}
              branch — it is manual by design, so it only builds when asked.
            </li>
            <li>
              Download the <code>aha-android-debug-apk</code> artifact and unzip
              it to get <code>app-debug.apk</code>.
            </li>
            <li>
              Copy it to your phone, or run{" "}
              <code>adb install app-debug.apk</code> with USB debugging on.
            </li>
            <li>
              Android will ask you to allow &quot;install unknown apps&quot; for
              whichever app you opened the file with. That prompt is expected for
              anything installed outside the Play Store.
            </li>
          </ol>
          <p className="muted sm" style={{ marginBottom: 0 }}>
            Downloading the artifact needs a GitHub account with access to the
            repository — GitHub does not serve workflow artifacts anonymously.
          </p>
        </div>
      )}

      {platform === "ios" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>On iPhone and iPad</h3>
          <p style={{ marginBottom: 8 }}>
            Nothing to install yet, and no waiting list to join — the honest
            position is that the iOS build cannot be distributed until it is
            signed with an Apple Developer identity.
          </p>
          <p style={{ marginBottom: 0 }}>
            In the meantime, add this site to your Home Screen: open it in
            Safari, tap <strong>Share</strong>, then{" "}
            <strong>Add to Home Screen</strong>. You get an icon that opens
            straight into AHA — which is very close to what the v1 app does.
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Building it yourself</h3>
        <p style={{ margin: 0 }}>
          Everything needed is in the repository under <code>mobile/</code>{" "}
          (Capacitor 7, app id <code>org.a13z.aha</code>), and the process is
          written up in <code>docs/mobile.md</code>. No signing keys, keystores
          or Apple certificates are stored in the repository — they are yours,
          and they stay yours.
        </p>
      </div>

      <p className="muted sm">
        The app collects nothing. No analytics, no advertising SDKs, no
        server-side collection by the shell. Location, if you use &quot;Find a
        Circle Near You&quot;, is the ordinary browser permission and is used on
        your device.
      </p>
    </>
  );
}
