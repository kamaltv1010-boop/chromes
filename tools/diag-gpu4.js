"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): which way of
// giving the page script keeps Chrome from ending at start (--disable-gpu,
// 0x80000003), each tried several times.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const root = path.join(__dirname, "..");
const { findChrome, ChromeInstance } = require(path.join(root, "main", "chrome.js"));
const { pageScript, workerScript } = require(path.join(root, "main", "inject.js"));
const { GPUS, graphicsOf } = require(path.join(root, "main", "gpus.js"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = process.env.NOOR_CHROME || findChrome();
const linux = process.platform === "linux" ? ["--no-sandbox"] : [];

let variant = "as now";
const attachedLog = [];
const realOnEvent = ChromeInstance.prototype.onEvent;
ChromeInstance.prototype.onEvent = function (event) {
  if (event.method === "Target.attachedToTarget" && event.params.targetInfo) attachedLog.push(`${event.params.targetInfo.type}:${String(event.params.targetInfo.url).slice(0, 50)}`);
  return realOnEvent.call(this, event);
};
const SITE = /^(https?|file|data|blob):/;
const realSend = ChromeInstance.prototype.send;
ChromeInstance.prototype.send = function (method, params, sessionId) {
  if (method === "Page.addScriptToEvaluateOnNewDocument" && variant !== "as now") {
    const info = this.pages.get(sessionId) || {};
    const url = info.url || "";
    const forSites = SITE.test(url) || (url === "about:blank" && info.type === "page");
    if (variant === "never at once") params = { ...params, runImmediately: false };
    if (variant === "at once in sites only" && !forSites) params = { ...params, runImmediately: false };
    if (variant === "none in Chrome's own" && !forSites && !(info.type === "page" && url === "")) return Promise.resolve(null);
  }
  return realSend.call(this, method, params, sessionId);
};

const ALL = { seeds: { canvas: 1, webGL: 2, audio: 3, clientRects: 4 }, screen: { width: 1920, height: 1080 }, hardware: { cores: 8, memory: 8 }, gpu: graphicsOf(GPUS[6]) };
const run = async (label) => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>t</title><body>t</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  attachedLog.length = 0;
  const instance = new ChromeInstance({
    executable: chrome, profile: { id: "diag", name: "Diag", proxy: "" }, dir: fs.mkdtempSync(path.join(os.tmpdir(), "diag-noor-")),
    pageScript: pageScript(ALL), workerScript: (u, hidden) => workerScript(ALL, u, hidden),
    screen: ALL.screen, timezone: "Europe/Paris", blockTrackers: true, extraArgs: [...linux, "--disable-gpu"],
  });
  let result;
  try {
    await instance.start();
    await instance.open(`http://127.0.0.1:${server.address().port}/`);
    await sleep(4000);
    let title = null;
    try { title = await instance.evaluate("document.title + ' ' + navigator.hardwareConcurrency"); } catch (e) { title = "ERR " + e.message; }
    result = { alive: !instance.closed, title, exitedWith: instance.exitedWith || null };
  } catch (error) {
    result = { failed: String(error.message || error).slice(0, 80), exitedWith: instance.exitedWith || null };
  }
  console.log(`=== ${label}: ${JSON.stringify(result)} attached ${JSON.stringify(attachedLog)}`);
  await instance.close().catch(() => {});
  server.close();
  return Boolean(instance.exitedWith && instance.exitedWith.code === 2147483651);
};

(async () => {
  console.log("chrome:", chrome);
  const summary = {};
  for (const name of ["as now", "never at once", "at once in sites only", "none in Chrome's own"]) {
    variant = name;
    let ended = 0;
    for (let i = 1; i <= 6; i++) if (await run(`${name} (${i})`)) ended++;
    summary[name] = `${ended} of 6 ended`;
  }
  console.log("SUMMARY " + JSON.stringify(summary));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
