/**
 * Capacitor config — Android APK.
 *
 * IMPORTANT: this Next.js app uses a server with server actions and dynamic
 * routes, so it CANNOT be exported as static HTML. The APK therefore loads the
 * deployed backend live (server-load architecture), never bundled. cleartext is
 * disabled in production — only HTTPS endpoints are reachable.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.fachursuite.sales",
  appName: "FachurSuite",
  webDir: "out", // dummy — the app loads the live server URL, not bundled HTML
  server: {
    // In production CI this is the deployed HTTPS backend. Never http in prod.
    url: process.env.CAP_SERVER_URL ?? "https://sales.example.com",
    cleartext: false,
    androidScheme: "https",
  },
};

export default config;
