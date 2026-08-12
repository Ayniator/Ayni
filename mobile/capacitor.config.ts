import type { CapacitorConfig } from '@capacitor/cli';

/**
 * AHA mobile shell — Capacitor configuration (F88/F89, Epic E12).
 *
 * v1 architecture: REMOTE-LOAD WebView.
 *   The native app is a thin shell whose WebView loads the deployed web app at
 *   https://aha.a13z.org:8443. Every web feature (wallet, circles, reflections,
 *   documents, ZK flows, the embedded "AHA Wallet") ships on mobile on day one
 *   with zero porting work, and web deploys update the mobile app instantly.
 *
 *   Tradeoff (accepted for v1): the app REQUIRES network connectivity to load;
 *   there is no offline shell. `webDir` ("www") is only a placeholder page shown
 *   if the remote server is unreachable — it is not the app.
 *
 * v2 roadmap: bundle the frontend as a static export into `webDir` (drop
 *   `server.url`), add native deep links and push notifications. See
 *   docs/mobile.md.
 */
const config: CapacitorConfig = {
  appId: 'org.a13z.aha',
  appName: 'AHA',
  webDir: 'www',
  server: {
    // v1: load the deployed web app inside the native WebView.
    url: 'https://aha.a13z.org:8443',
    // HTTPS only — never allow cleartext traffic.
    cleartext: false,
  },
};

export default config;
