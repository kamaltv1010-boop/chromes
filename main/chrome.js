"use strict";
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { Connection } = require("./cdp");
const { blockedFor } = require("./trackers");

/// How long Chrome has to open its debugging port.
const START_WAIT = 30 * 1000;

/// A port free on this computer now, for Chrome to debug on.
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

/// The browser's address from what Chrome's debugging port answers at
/// /json/version, or null if that isn't Chrome's answer on `port`.
const browserAddress = (text, port) => {
  let answer;
  try {
    answer = JSON.parse(text);
  } catch (error) {
    return null;
  }
  const address = answer && answer.webSocketDebuggerUrl;
  const pattern = new RegExp(`^ws://127\\.0\\.0\\.1:${port}/devtools/browser/[\\w-]+$`);
  return typeof address === "string" && pattern.test(address) ? address : null;
};

/// What `port` answers at /json/version, or null for no answer yet.
const askVersion = (port) => new Promise((resolve) => {
  const request = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 2000 }, (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => resolve(response.statusCode === 200 ? text : null));
    response.on("error", () => resolve(null));
  });
  request.on("timeout", () => request.destroy());
  request.on("error", () => resolve(null));
});

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

/// Chrome open for a profile: its process, the debugging connection to it,
/// and every page and worker it makes, held as it starts, given the
/// protection and the profile's time zone and blocked trackers, then let
/// go. Nothing of it marks the browser as automated.
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
    this.port = 0;
    this.connection = null;
    /// The sessions of pages (and frames in other processes), with the
    /// page's address, for the trackers blocked there.
    this.pages = new Map();
    /// The protection's script in each of them, by its id there.
    this.scripts = new Map();
    /// Each page's session once it is set up, by its target's id (see open).
    this.ready = new Map();
    this.closed = false;
  }

  args() {
    const list = [
      `--user-data-dir=${this.dir}`,
      // A debugging port of its own, chosen here: Chrome takes a port it is
      // given as a developer's debugger, and shows pages nothing of it,
      // where a debugging pipe, or a port it picks itself, marks it
      // automated (navigator.webdriver), which only a flag Chrome warns
      // about on every start ("unsupported command-line flag") would hide.
      // It listens on this computer only, and refuses pages (see Connection).
      `--remote-debugging-port=${this.port}`,
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
    this.port = await freePort();
    this.child = spawn(this.executable, this.args(), { stdio: "ignore", windowsHide: false });
    this.child.on("exit", () => this.ended());
    this.child.on("error", () => this.ended());
    try {
      const address = await this.waitForAddress();
      this.connection = await Connection.open(address);
      this.connection.on("event", (event) => this.onEvent(event));
      this.connection.on("close", () => this.ended());
      await this.connection.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    } catch (error) {
      // Chrome isn't left open without the protection.
      this.ended();
      throw error;
    }
  }

  /// Chrome's address, once its debugging port answers.
  async waitForAddress() {
    const until = Date.now() + START_WAIT;
    while (!this.closed && Date.now() < until) {
      const address = browserAddress(await askVersion(this.port), this.port);
      if (address) {
        return address;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.closed && this.child) {
      try { this.child.kill(); } catch (error) {}
    }
    throw new Error(this.closed ? "Chrome closed as it started (is this profile open in another Chrome?)" : "Chrome didn't open its debugging port");
  }

  /// Chrome is gone, or its connection: once. Chrome without the
  /// connection would open pages without the protection, so it is closed.
  ended() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.connection) {
      this.connection.close();
    }
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try { this.child.kill(); } catch (error) {}
    }
    this.emit("exit");
  }

  send(method, params, sessionId) {
    if (!this.connection) {
      return Promise.resolve(null);
    }
    return this.connection.send(method, params, sessionId).catch(() => null);
  }

  onEvent({ method, params, sessionId }) {
    if (method === "Target.attachedToTarget" && params.targetInfo) {
      const setUp = this.attached(params.sessionId, params.targetInfo, params.waitingForDebugger !== false).catch(() => {});
      if (params.targetInfo.type === "page") {
        this.ready.set(params.targetInfo.targetId, setUp.then(() => params.sessionId));
      }
    } else if (method === "Target.detachedFromTarget") {
      this.pages.delete(params.sessionId);
      this.scripts.delete(params.sessionId);
      if (params.targetId) {
        this.ready.delete(params.targetId);
      }
    } else if (method === "Network.requestWillBeSent" && params.type === "Document" && params.request) {
      // A page's next document, asked for: the trackers blocked are those
      // of the site it is on, before its own requests go.
      this.navigated(sessionId, params.frameId, params.request.url);
    } else if (method === "Page.frameNavigated" && params.frame && !params.frame.parentId) {
      this.navigated(sessionId, params.frame.id, params.frame.url);
    }
  }

  /// The main frame of the page of `sessionId` (its id is the target's) is
  /// going to `url`, or is there.
  navigated(sessionId, frameId, url) {
    const info = this.pages.get(sessionId);
    if (!info || frameId !== info.targetId || typeof url !== "string" || info.url === url) {
      return;
    }
    this.pages.set(sessionId, Object.assign({}, info, { url }));
    this.block(sessionId, url);
  }

  /// A page or worker Chrome made, `held` before its first line (or, one
  /// open before the app was, not).
  async attached(sessionId, info, held) {
    const type = info.type;
    if (type === "page" || type === "iframe" || type === "webview" || type === "background_page") {
      const setUp = this.setUpPage(sessionId, info);
      if (held) {
        // A tab opened from a link, held, has no renderer yet: Chrome keeps
        // what is sent for it, in order, and hands it over as the tab goes
        // on, before its page. Waiting for answers first would wait forever.
        await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
        await setUp;
        return;
      }
      await setUp;
      // A page open before the protection was given (one Chrome opened as
      // it started, a tab it restored) has run without it: if it shows a
      // web page, that is loaded again, now with it.
      if (type === "page") {
        const tree = await this.send("Page.getFrameTree", {}, sessionId);
        const url = (tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.url) || "";
        if (/^https?:/i.test(url)) {
          await this.send("Page.reload", {}, sessionId);
        }
      }
    } else if (type === "worker" || type === "service_worker" || type === "shared_worker") {
      await this.setUpWorker(sessionId, info);
    }
    await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
  }

  /// Gives a page what it needs, all sent at once, in order (see attached).
  setUpPage(sessionId, info) {
    this.pages.set(sessionId, info);
    const sent = [
      // Every document from now on, and the one there now: in a page held
      // as it opens, that one's scripts wait for it. (A page that was open
      // before has run its own: it is loaded again, see attached.)
      this.send("Page.addScriptToEvaluateOnNewDocument", { source: this.pageScript, runImmediately: true }, sessionId).then((added) => {
        if (added && added.identifier) {
          this.scripts.set(sessionId, added.identifier);
        }
      }),
      // Without it, a page that was open before (not held as it started)
      // runs none of the scripts given it.
      this.send("Page.enable", {}, sessionId),
    ];
    if (this.timezone) {
      sent.push(this.send("Emulation.setTimezoneOverride", { timezoneId: this.timezone }, sessionId));
    }
    if (this.blockTrackers) {
      sent.push(this.send("Network.enable", {}, sessionId), this.block(sessionId, info.url));
    }
    // The page's own workers (and frames in other processes), held as they
    // start. Service and shared workers are the browser's, reached from it
    // (see start): held by two, a worker would wait for both.
    sent.push(this.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "service_worker", exclude: true }, { type: "shared_worker", exclude: true }, {}],
    }, sessionId));
    return Promise.all(sent);
  }

  /// Runs the protection in a held worker before its first line. Given as
  /// the argument of a call, as text, it is compiled as the debugger's own
  /// code (Runtime.callFunctionOn compiles such an argument that way), which
  /// V8 leaves out of stack traces and shows as built-in: nothing of it
  /// shows in a stack the worker's code reads, as nothing of the browser's
  /// own built-ins does. Failing that, it is run as a script.
  async setUpWorker(sessionId, info) {
    const url = info.url || "";
    // Chrome's own workers and extensions' are left alone: only sites' are protected.
    if (!/^(https?|blob|data|file):/i.test(url)) {
      return;
    }
    const hidden = this.workerScript(url, true);
    if (!hidden || !this.connection) {
      return;
    }
    const send = (method, params) => this.connection.send(method, params, sessionId);
    try {
      const global = await send("Runtime.evaluate", { expression: "globalThis", silent: true });
      const objectId = global && global.result && global.result.objectId;
      if (!objectId) {
        throw new Error("No global");
      }
      try {
        const done = await send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function () {}",
          arguments: [{ unserializableValue: hidden }],
          silent: true,
        });
        if (done && done.exceptionDetails) {
          throw new Error("Not run");
        }
      } finally {
        send("Runtime.releaseObject", { objectId }).catch(() => {});
      }
    } catch (error) {
      const plain = this.workerScript(url, false);
      if (plain) {
        await this.send("Runtime.evaluate", { expression: plain, silent: true }, sessionId);
      }
    }
  }

  block(sessionId, url) {
    if (!this.blockTrackers) {
      return Promise.resolve();
    }
    return this.send("Network.setBlockedURLs", { urls: blockedFor(url) }, sessionId);
  }

  /// New scripts for the protection (new fingerprints, or a protection
  /// turned on or off): pages get them as they load from now on, workers
  /// as they start.
  async setScripts(pageScript, workerScript) {
    this.pageScript = pageScript;
    this.workerScript = workerScript;
    for (const sessionId of [...this.pages.keys()]) {
      const old = this.scripts.get(sessionId);
      if (old) {
        await this.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: old }, sessionId);
      }
      const added = await this.send("Page.addScriptToEvaluateOnNewDocument", { source: pageScript }, sessionId);
      if (added && added.identifier) {
        this.scripts.set(sessionId, added.identifier);
      }
    }
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
    const result = await this.connection.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, entry[0]);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Evaluation failed");
    }
    return result.result ? result.result.value : undefined;
  }

  /// Opens `url` in a new tab, once the tab has the protection: a tab
  /// opened at an address by the debugger itself isn't held for it.
  async open(url) {
    const created = await this.send("Target.createTarget", { url: "about:blank" });
    const targetId = created && created.targetId;
    for (let i = 0; targetId && i < 100 && !this.ready.has(targetId); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const sessionId = targetId && this.ready.has(targetId) ? await this.ready.get(targetId) : null;
    if (!sessionId) {
      throw new Error("The new tab wasn't reached");
    }
    await this.send("Page.navigate", { url }, sessionId);
    return created;
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

module.exports = { ChromeInstance, findChrome, chromePaths, browserAddress, freePort };
