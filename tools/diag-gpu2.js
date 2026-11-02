"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): which part of
// Noor ends Chrome with --disable-gpu (as on a Windows with no graphics
// card), 0x80000003 in under a second.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const root = path.join(__dirname, "..");
const { findChrome, ChromeInstance } = require(path.join(root, "main", "chrome.js"));
const { pageScript, workerScript } = require(path.join(root, "main", "inject.js"));
const { GPUS, graphicsOf } = require(path.join(root, "main", "gpus.js"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = process.env.NOOR_CHROME || findChrome();
const linux = process.platform === "linux" ? ["--no-sandbox"] : [];
const WEBGL_PAGE = "data:text/html,<title>w</title><script>const g = document.createElement('canvas').getContext('webgl'); document.title = g ? 'webgl ' + g.getParameter(g.RENDERER) : 'no webgl';</script>";

const plain = (label, extra, ms = 8000) => new Promise((resolve) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-gpu-"));
  const started = Date.now();
  const child = spawn(chrome, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", ...linux, ...extra], { stdio: "ignore" });
  let done = false;
  const end = (result) => { if (!done) { done = true; console.log(`=== ${label}: ${JSON.stringify(result)}`); resolve(); } };
  child.on("exit", (code) => end({ alive: false, code, after: Date.now() - started }));
  setTimeout(() => { try { child.kill(); } catch (e) {} end({ alive: true, for: ms }); }, ms);
});

const viaNoor = async (label, extra, config, { openPage = true, url = null } = {}) => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>t</title><body>t</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const instance = new ChromeInstance({
    executable: chrome,
    profile: { id: "diag", name: "Diag", proxy: "" },
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "diag-noor-")),
    pageScript: config ? pageScript(config) : "",
    workerScript: config ? (u, hidden) => workerScript(config, u, hidden) : () => "",
    screen: null,
    timezone: null,
    blockTrackers: false,
    extraArgs: [...linux, ...extra],
  });
  const started = Date.now();
  let result;
  try {
    await instance.start();
    if (openPage) await instance.open(url || `http://127.0.0.1:${server.address().port}/`);
    await sleep(6000);
    let title = null;
    try { title = await instance.evaluate("document.title"); } catch (e) { title = "ERR " + e.message; }
    result = { alive: !instance.closed, exitedWith: instance.exitedWith || null, title };
  } catch (error) {
    result = { failed: String(error.message || error), exitedWith: instance.exitedWith || null, after: Date.now() - started };
  }
  console.log(`=== ${label}: ${JSON.stringify(result)}`);
  await instance.close().catch(() => {});
  server.close();
};

const ALL = { seeds: { canvas: 1, webGL: 2, audio: 3, clientRects: 4 }, screen: { width: 1920, height: 1080 }, hardware: { cores: 8, memory: 8 }, gpu: graphicsOf(GPUS[6]) };
const only = (part) => Object.assign({ seeds: { canvas: null, webGL: null, audio: null, clientRects: null }, screen: null, hardware: null, gpu: null }, part);
const D = ["--disable-gpu"];

(async () => {
  console.log("chrome:", chrome);
  await plain("Chrome alone, a page with WebGL", [WEBGL_PAGE]);
  await plain("Chrome alone, a page with WebGL, --disable-gpu", [...D, WEBGL_PAGE]);
  await viaNoor("Noor, --disable-gpu, no script, no tab opened", D, null, { openPage: false });
  await viaNoor("Noor, --disable-gpu, no script, a tab", D, null);
  await viaNoor("Noor, --disable-gpu, protection, no tab opened", D, ALL, { openPage: false });
  await viaNoor("Noor, --disable-gpu, protection with nothing on", D, only({}));
  await viaNoor("Noor, --disable-gpu, canvas only", D, only({ seeds: { canvas: 1, webGL: null, audio: null, clientRects: null } }));
  await viaNoor("Noor, --disable-gpu, webGL only", D, only({ seeds: { canvas: null, webGL: 2, audio: null, clientRects: null } }));
  await viaNoor("Noor, --disable-gpu, audio only", D, only({ seeds: { canvas: null, webGL: null, audio: 3, clientRects: null } }));
  await viaNoor("Noor, --disable-gpu, clientRects only", D, only({ seeds: { canvas: null, webGL: null, audio: null, clientRects: 4 } }));
  await viaNoor("Noor, --disable-gpu, gpu only", D, only({ gpu: graphicsOf(GPUS[6]) }));
  await viaNoor("Noor, --disable-gpu, screen and hardware only", D, only({ screen: { width: 1920, height: 1080 }, hardware: { cores: 8, memory: 8 } }));
  await viaNoor("Noor, --disable-gpu, no script, the WebGL page", D, null, { url: WEBGL_PAGE });
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
