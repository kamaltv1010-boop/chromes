"use strict";
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { Pipe } = require("./cdp");
const { blockedFor } = require("./trackers");

/// Where Google Chrome usually is.
const chromePaths = () => {
  const found = [];
  if (process.env.NOOR_CHROME) {
    found.push(process.env.NOOR_CHROME);
  }
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (base) {
        found.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
      }
    }
  } else if (process.platform === "darwin") {
    found.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    found.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return found;
};

const isFile = (file) => {
  try {
    return Boolean(file) && fs.statSync(file).isFile();
  } catch (error) {
    return false;
  }
};

/// Chrome's program: the one chosen, else the first found.
const findChrome = (chosen) => [chosen].concat(chromePaths()).find(isFile) || null;

/// Chrome open for a profile: its process, the debugging pipe to it, and
/// every page and worker it makes, held as it starts, given the
/// protection and the profile's time zone and blocked trackers, then let
/// go. Chrome sees none of this on the network (the pipe is its own), and
/// nothing of it marks the browser as automated.
class ChromeInstance extends EventEmitter {
  constructor({ executable, profile, dir, pageScript, workerScript, timezone = null, blockTrackers = true, extraArgs = [] }) {
    super();
    this.executable = executable;
    this.profile = profile;
    this.dir = dir;
    this.pageScript = pageScript;
    this.workerScript = workerScript;
    this.timezone = timezone;
    this.blockTrackers = blockTrackers;
    this.extraArgs = extraArgs;
    this.child = null;
    this.pipe = null;
    /// The sessions of pages (and frames in other processes), with the
    /// page's address, for the trackers blocked there.
    this.pages = new Map();
    this.closed = false;
  }

  args() {
    const list = [
      `--user-data-dir=${this.dir}`,
      "--remote-debugging-pipe",
      // Chrome marks itself automated (navigator.webdriver) whenever a
      // debugging pipe is open; a page would read that, so it is off.
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ];
    if (this.profile.proxy) {
      list.push(`--proxy-server=${this.profile.proxy}`);
    }
    return list.concat(this.extraArgs);
  }

  async start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.child = spawn(this.executable, this.args(), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: false });
    this.pipe = new Pipe(this.child);
    this.pipe.on("event", (event) => this.onEvent(event));
    this.pipe.on("close", () => {
      this.closed = true;
      this.emit("exit");
    });
    await this.pipe.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  }

  send(method, params, sessionId) {
    return this.pipe.send(method, params, sessionId).catch(() => null);
  }

  onEvent({ method, params }) {
    if (method === "Target.attachedToTarget" && params.targetInfo) {
      this.attached(params.sessionId, params.targetInfo).catch(() => {});
    } else if (method === "Target.detachedFromTarget") {
      this.pages.delete(params.sessionId);
    } else if (method === "Target.targetInfoChanged" && params.targetInfo) {
      for (const [sessionId, info] of this.pages) {
        if (info.targetId === params.targetInfo.targetId && info.url !== params.targetInfo.url) {
          this.pages.set(sessionId, params.targetInfo);
          this.block(sessionId, params.targetInfo.url);
        }
      }
    }
  }

  async attached(sessionId, info) {
    const type = info.type;
    if (type === "page" || type === "iframe" || type === "webview" || type === "background_page") {
      await this.setUpPage(sessionId, info);
    } else if (type === "worker" || type === "service_worker" || type === "shared_worker") {
      await this.setUpWorker(sessionId, info);
    }
    await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
  }

  async setUpPage(sessionId, info) {
    this.pages.set(sessionId, info);
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: this.pageScript, runImmediately: true }, sessionId);
    if (this.timezone) {
      await this.send("Emulation.setTimezoneOverride", { timezoneId: this.timezone }, sessionId);
    }
    if (this.blockTrackers) {
      await this.send("Network.enable", {}, sessionId);
      await this.block(sessionId, info.url);
    }
    // The page's own workers (and frames in other processes), held as they start.
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  }

  async setUpWorker(sessionId, info) {
    const script = this.workerScript(info.url || "");
    if (script) {
      await this.send("Runtime.evaluate", { expression: script, silent: true }, sessionId);
    }
  }

  block(sessionId, url) {
    if (!this.blockTrackers) {
      return Promise.resolve();
    }
    return this.send("Network.setBlockedURLs", { urls: blockedFor(url) }, sessionId);
  }

  /// A new time zone (or null, the system's) for every page from now on.
  async setTimezone(zone) {
    this.timezone = zone || null;
    for (const sessionId of this.pages.keys()) {
      await this.send("Emulation.setTimezoneOverride", { timezoneId: this.timezone || "" }, sessionId);
    }
  }

  /// Runs `expression` in the first web page (the last one opened), for tests.
  async evaluate(expression) {
    const entry = [...this.pages.entries()].reverse().find(([, info]) => info.type === "page" && /^https?:/.test(info.url || ""));
    if (!entry) {
      throw new Error("No page");
    }
    const result = await this.pipe.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, entry[0]);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Evaluation failed");
    }
    return result.result ? result.result.value : undefined;
  }

  /// Opens `url` in a new tab.
  open(url) {
    return this.send("Target.createTarget", { url });
  }

  /// Asks Chrome to close, and ends it if it doesn't.
  async close() {
    if (this.closed) {
      return;
    }
    await this.send("Browser.close", {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!this.closed && this.child) {
      try { this.child.kill(); } catch (error) {}
    }
  }
}

module.exports = { ChromeInstance, findChrome, chromePaths };
