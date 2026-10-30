"use strict";
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");
const { Store } = require("./store");
const { Profiles } = require("./profiles");
const { Fingerprint, KINDS } = require("./fingerprint");
const { Timezone } = require("./timezone");
const { ChromeInstance, findChrome } = require("./chrome");
const { pageScript, workerScript } = require("./inject");

let store = null;
let profiles = null;
let fingerprint = null;
let timezone = null;
let win = null;
/// Chrome open per profile id, and opening (while a proxy's time zone is
/// asked), so a profile opens once.
const instances = new Map();
const opening = new Map();

const chromePath = () => findChrome(store.get("chromePath", null));

const state = () => ({
  profiles: profiles.all().map((p) => ({ ...p, running: instances.has(p.id), screen: fingerprint.screen(p), hardware: fingerprint.hardware(p), zone: p.proxy ? timezone.for(p.proxy) : null })),
  protections: Object.fromEntries(KINDS.map((kind) => [kind, fingerprint.isEnabled(kind)])),
  blockTrackers: store.get("blockTrackers", true) !== false,
  timezoneFromIP: timezone.enabled(),
  timezone: timezone.current,
  chromePath: chromePath(),
  chromeChosen: store.get("chromePath", null),
  version: app.getVersion(),
});

const push = () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send("noor:state", state());
  }
};

/// The protection's scripts for a profile's pages and workers, and the
/// screen Chrome shows its pages, as set now.
const scriptsFor = (profile) => {
  const config = fingerprint.config(profile);
  return {
    pageScript: pageScript(config),
    workerScript: (url, hidden) => workerScript(config, url, hidden),
    screen: config.screen,
  };
};

/// Chrome open for `profile` (or for every profile) gets its protection
/// as set now: new fingerprints, or a protection turned on or off, reach
/// its pages as they load again.
const refresh = (profile = null) => {
  for (const [id, instance] of instances) {
    const owner = profile ? (id === profile.id ? profile : null) : profiles.find(id);
    if (owner) {
      const { pageScript: page, workerScript: worker, screen: shown } = scriptsFor(owner);
      instance.setScripts(page, worker).then(() => instance.setScreen(shown)).catch(() => {});
    }
  }
};

/// Opens Chrome for a profile, with the protection, the time zone and
/// the trackers blocked as set now.
const open = (profile) => {
  if (instances.has(profile.id)) {
    return Promise.resolve(instances.get(profile.id));
  }
  if (!opening.has(profile.id)) {
    opening.set(profile.id, start(profile).finally(() => opening.delete(profile.id)));
  }
  return opening.get(profile.id);
};

const start = async (profile) => {
  const executable = chromePath();
  if (!executable) {
    throw new Error("Google Chrome wasn't found. Choose chrome.exe in Settings.");
  }
  const instance = new ChromeInstance({
    executable,
    profile,
    dir: profiles.dir(profile),
    ...scriptsFor(profile),
    // A profile with a proxy shows its proxy's zone, found through it.
    timezone: await timezone.forOpening(profile.proxy),
    blockTrackers: store.get("blockTrackers", true) !== false,
    extraArgs: (process.env.NOOR_CHROME_ARGS || "").split(" ").filter(Boolean),
  });
  instances.set(profile.id, instance);
  instance.on("exit", () => {
    instances.delete(profile.id);
    push();
  });
  try {
    await instance.start();
  } catch (error) {
    instances.delete(profile.id);
    throw error;
  }
  push();
  return instance;
};

const handle = (channel, handler) => {
  ipcMain.handle("noor:" + channel, async (event, ...args) => {
    const result = await handler(...args);
    return result === undefined ? state() : result;
  });
};

const registerIPC = () => {
  handle("state", () => state());
  handle("profiles:add", (name) => { profiles.add(name); });
  handle("profiles:rename", (id, name) => { profiles.rename(id, name); });
  handle("profiles:proxy", (id, proxy) => { profiles.setProxy(id, proxy); });
  handle("profiles:remove", async (id) => {
    const profile = profiles.find(id);
    if (!profile) {
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Delete the profile "${profile.name}"?`,
      detail: "Its cookies, logins, extensions, history and fingerprints are deleted. If Chrome is open for it, it is closed first.",
    });
    if (response !== 0) {
      return;
    }
    const instance = instances.get(id);
    if (instance) {
      await instance.close();
    }
    profiles.remove(id);
  });
  handle("fingerprint:new", (id, kinds) => {
    const profile = profiles.find(id);
    if (profile) {
      fingerprint.newSeeds(Array.isArray(kinds) ? kinds.filter((k) => KINDS.includes(k)) : KINDS, profile);
      refresh(profile);
    }
  });
  handle("chrome:open", async (id) => {
    const profile = profiles.find(id);
    if (!profile) {
      return;
    }
    try {
      await open(profile);
    } catch (error) {
      dialog.showMessageBox(win, { type: "error", message: "Chrome didn't open", detail: String(error.message || error) });
    }
  });
  handle("chrome:close", async (id) => {
    const instance = instances.get(id);
    if (instance) {
      await instance.close();
    }
  });
  handle("chrome:choose", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Where is Google Chrome?",
      filters: process.platform === "win32" ? [{ name: "chrome.exe", extensions: ["exe"] }] : [],
      properties: ["openFile"],
    });
    if (!canceled && filePaths[0]) {
      store.set("chromePath", filePaths[0]);
    }
  });
  handle("settings:set", (key, value) => {
    if (key.startsWith("protection.") && KINDS.includes(key.slice("protection.".length))) {
      fingerprint.setEnabled(key.slice("protection.".length), Boolean(value));
      refresh();
    } else if (key === "timezoneFromIP") {
      timezone.setEnabled(Boolean(value));
    } else if (key === "blockTrackers") {
      store.set("blockTrackers", Boolean(value));
    } else {
      throw new Error("Unknown setting");
    }
  });
  handle("open:link", (url) => { shell.openExternal(String(url)); });
};

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  store = new Store(path.join(userData, "settings.json"));
  profiles = new Profiles(store, userData);
  fingerprint = new Fingerprint(store, profiles);
  const display = screen.getPrimaryDisplay();
  fingerprint.realScreen = { width: display.size.width, height: display.size.height };
  timezone = new Timezone(store, { forced: process.env.NOOR_TEST_TIMEZONE || null });
  timezone.onChange(() => {
    for (const [id, instance] of instances) {
      const profile = profiles.find(id);
      instance.setTimezone(timezone.for(profile ? profile.proxy : "")).catch(() => {});
    }
    push();
  });
  timezone.start();
  // A proxy's address can change too: asked again every so often while
  // a profile using it is open.
  setInterval(() => {
    for (const id of instances.keys()) {
      const profile = profiles.find(id);
      if (profile && profile.proxy) {
        timezone.refreshProxy(profile.proxy);
      }
    }
  }, 15 * 60 * 1000).unref();
  if (profiles.all().length === 0) {
    profiles.add("Personal");
  }

  win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 420,
    minHeight: 480,
    title: "Noor for Chrome",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "..", "renderer", "preload.js"), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  registerIPC();

  if (process.env.NOOR_TEST) {
    global.noorTest = { store, profiles, fingerprint, timezone, instances, open, state };
  }
});

app.on("before-quit", (event) => {
  // Chrome opened by Noor closes with it: without Noor, new pages would
  // go unprotected.
  if (instances.size) {
    event.preventDefault();
    Promise.all([...instances.values()].map((instance) => instance.close())).finally(() => {
      instances.clear();
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
