/**
 * Electron shell (scaffolding for the Windows EXE stage).
 * Strategy: the Next.js app is exported/started by the packaged app, then the
 * shell loads it. During packaging stages this file gains auto-updater and
 * single-instance handling.
 *
 * Build stage (later): electron-builder → dist/InstallmentSales-Setup.exe
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: "FachurSuite — سامانه مدیریت فروش نقدی و اقساطی",
    icon: path.join(__dirname, "../public/icon-512.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
