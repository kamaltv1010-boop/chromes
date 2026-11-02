"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): Chrome's own log
// (stderr) as it ends with 0x80000003 under Noor's protection.
const cp = require("child_process");
const realSpawn = cp.spawn;
const logs = [];
cp.spawn = (command, args, options) => {
  const child = realSpawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const entry = { text: "" };
  logs.push(entry);
  child.stdout.on("data", () => {});
  child.stderr.on("data", (data) => { entry.text += data; if (entry.text.length > 400000) entry.text = entry.text.slice(-200000); });
  return child;
};
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
const LOG = ["--enable-logging=stderr", "--v=0"];

// The page script, run only where every frame above it is a site's (not
// in an empty frame of Chrome's own pages, as its new tab page's).
const CHECK = 'if (!/^(https?|file|data|blob|about):$/.test(location.protocol)) return;';
const SITES_ONLY = CHECK + '\ntry { const a = location.ancestorOrigins; if (a) for (let i = 0; i < a.length; i++) if (!/^(https?:|file:|null$)/.test(a[i])) return; } catch (e) {}\ntry { if (!/^(https?:|file:|null$)/.test(self.origin)) return; } catch (e) {}';
const sitesOnly = (script) => { if (!script.includes(CHECK)) throw new Error("check not found"); return script.replace(CHECK, SITES_ONLY); };

const run = async (label, extra, config, openPage, onlySites = false) => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>t</title><body>t</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const instance = new ChromeInstance({
    executable: chrome, profile: { id: "diag", name: "Diag", proxy: "" }, dir: fs.mkdtempSync(path.join(os.tmpdir(), "diag-noor-")),
    pageScript: config ? (onlySites ? sitesOnly(pageScript(config)) : pageScript(config)) : "", workerScript: config ? (u, hidden) => workerScript(config, u, hidden) : () => "",
    screen: config ? config.screen : null, timezone: null, blockTrackers: false, extraArgs: [...linux, ...LOG, ...extra],
  });
  // What Chrome said about each target it attached, for the log.
  const seen = [];
  const before = logs.length;
  let result;
  try {
    await instance.start();
    instance.connection.on("event", ({ method, params }) => {
      if (method === "Target.attachedToTarget" && params.targetInfo) seen.push(`${params.targetInfo.type} ${String(params.targetInfo.url).slice(0, 80)}`);
    });
    if (openPage) await instance.open(`http://127.0.0.1:${server.address().port}/`);
    await sleep(6000);
    result = { alive: !instance.closed, exitedWith: instance.exitedWith || null };
  } catch (error) {
    result = { failed: String(error.message || error), exitedWith: instance.exitedWith || null };
  }
  console.log(`=== ${label}: ${JSON.stringify(result)}`);
  console.log("targets: " + JSON.stringify(seen));
  if (instance.exitedWith) {
    const text = (logs[before] || { text: "" }).text;
    const lines = text.split(/\r?\n/).filter((line) => line.trim() && !/content_verifier|content_hash|scheduler_loop_quarantine|install_signer|VERBOSE/.test(line));
    console.log(`stderr (${lines.length} lines), the last 40:\n` + lines.slice(-40).join("\n"));
  }
  await instance.close().catch(() => {});
  server.close();
};

const ALL = { seeds: { canvas: 1, webGL: 2, audio: 3, clientRects: 4 }, screen: { width: 1920, height: 1080 }, hardware: { cores: 8, memory: 8 }, gpu: graphicsOf(GPUS[6]) };
(async () => {
  console.log("chrome:", chrome);
  for (let i = 1; i <= 3; i++) await run(`--disable-gpu, all protections, no tab (${i})`, ["--disable-gpu"], ALL, false);
  for (let i = 1; i <= 2; i++) await run(`--disable-gpu, all protections, a tab (${i})`, ["--disable-gpu"], ALL, true);
  for (let i = 1; i <= 3; i++) await run(`no flag, all protections, a tab (${i})`, [], ALL, true);
  for (let i = 1; i <= 2; i++) await run(`--disable-gpu, no script, a tab (${i})`, ["--disable-gpu"], null, true);
  for (let i = 1; i <= 4; i++) await run(`--disable-gpu, all protections, sites only, no tab (${i})`, ["--disable-gpu"], ALL, false, true);
  for (let i = 1; i <= 3; i++) await run(`--disable-gpu, all protections, sites only, a tab (${i})`, ["--disable-gpu"], ALL, true, true);
  for (let i = 1; i <= 3; i++) await run(`no flag, all protections, sites only, a tab (${i})`, [], ALL, true, true);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
