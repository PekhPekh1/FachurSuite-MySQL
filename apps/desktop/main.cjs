/**
 * Desktop client (Electron) — Windows EXE via electron-builder.
 *
 * ARCHITECTURE: this is a DESKTOP CLIENT, not a fully local application. It
 * loads the deployed backend over HTTPS from DESKTOP_BACKEND_URL. No business
 * data is stored in the client beyond the session cookie, exactly as in the
 * browser. A local (single-machine) deployment is supported by pointing the
 * client at a locally hosted Node + PostgreSQL stack — see docs/DESKTOP.md.
 */
const { app, BrowserWindow, Tray, Menu, nativeTheme, shell, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

const BACKEND_URL =
  process.env.DESKTOP_BACKEND_URL ||
  process.env.APP_BACKEND_URL ||
  "https://sales.example.com"; // overridden at packaging time / by user settings

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Only one instance: prevents two tray icons / racing windows.
  app.quit();
}

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "FachurSuite — سامانه فروش نقدی و اقساطی",
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b1020" : "#f5f7fb",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Load the deployed backend. If unreachable, show a local fallback that
  // explains the state instead of a blank window.
  mainWindow.loadURL(BACKEND_URL).catch(async () => {
    const fallback = path.join(__dirname, "assets", "offline.html");
    if (fs.existsSync(fallback)) await mainWindow.loadFile(fallback);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open receipts/documents externally (PDF downloads, browser-printed pages).
    if (url.startsWith(BACKEND_URL) || url.startsWith("file://")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, "assets", "icon.png"));
    const context = Menu.buildFromTemplate([
      { label: "باز کردن", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: "separator" },
      { label: "خروج", click: () => app.quit() },
    ]);
    tray.setToolTip("FachurSuite — سامانه فروش نقدی و اقساطی");
    tray.setContextMenu(context);
    tray.on("click", () => mainWindow?.show());
  } catch {
    // Tray is optional on platforms without a system tray host.
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Intentionally NO auto-updater: updates ship as new signed installers from
  // the release workflow. An in-app updater without code-signing verification is
  // insecure; auto-update publishing is therefore `publish: never`.

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  // Keep the tray alive — the user explicitly quits from the tray menu.
});

app.on("before-quit", () => {
  if (tray) tray.destroy();
});

void dialog;
void Notification;
