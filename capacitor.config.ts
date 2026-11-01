/**
 * Capacitor shell (scaffolding for the Android APK stage).
 * The app points at the deployed (or LAN) Next.js server; offline mode is out
 * of scope per the business requirements. `npm i -D @capacitor/cli` +
 * `npx cap add android` happen in the packaging stage, where this file's export
 * will be typed as `CapacitorConfig`.
 */
const config = {
  appId: "com.fachursuite.sales",
  appName: "FachurSuite",
  webDir: "out",
  server: {
    url: process.env.CAP_SERVER_URL ?? "http://10.0.2.2:3000",
    cleartext: true, // dev only — use HTTPS in production
  },
};

export default config;
