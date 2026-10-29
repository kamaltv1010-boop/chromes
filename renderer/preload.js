"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noor", {
  invoke: (channel, ...args) => ipcRenderer.invoke("noor:" + channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on("noor:" + channel, (event, ...args) => listener(...args));
  },
});
