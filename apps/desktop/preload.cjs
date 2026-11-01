const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("installmentsDesktop", {
  platform: process.platform,
  version: "1.0.0",
});
