"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): does Chrome
// itself, with no Noor, end at once on a Windows with no graphics card?
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const root = path.join(__dirname, "..");
const { findChrome, ChromeInstance } = require(path.join(root, "main", "chrome.js"));
const { pageScript, workerScript } = require(path.join(root, "main", "inject.js"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = process.env.NOOR_CHROME || findChrome();
const linux = process.platform === "linux" ? ["--no-sandbox"] : [];

const plain = (label, extra, ms = 12000) => new Promise((resolve) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-gpu-"));
  const started = Date.now();
  const child = spawn(chrome, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", ...linux, ...extra], { stdio: "ignore" });
  let done = false;
  const end = (result) => { if (!done) { done = true; console.log(`=== ${label}: ${JSON.stringify(result)}`); resolve(); } };
  child.on("exit", (code) => end({ alive: false, code, after: Date.now() - started }));
  setTimeout(() => { try { child.kill(); } catch (e) {} end({ alive: true, for: ms }); }, ms);
});

const viaNoor = async (label, extra, scripts) => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>t</title><body>t</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = { seeds: { canvas: 1, webGL: 2, audio: null, clientRects: null }, screen: null, hardware: null, gpu: null };
  const instance = new ChromeInstance({
    executable: chrome,
    profile: { id: "diag", name: "Diag", proxy: "" },
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "diag-noor-")),
    pageScript: scripts ? pageScript(config) : "",
    workerScript: scripts ? (url, hidden) => workerScript(config, url, hidden) : () => "",
    screen: null,
    timezone: null,
    blockTrackers: false,
    extraArgs: [...linux, ...extra],
  });
  const started = Date.now();
  let result;
  try {
    await instance.start();
    await instance.open(`http://127.0.0.1:${server.address().port}/`);
    await sleep(8000);
    result = { alive: !instance.closed, exitedWith: instance.exitedWith || null };
  } catch (error) {
    result = { failed: String(error.message || error), exitedWith: instance.exitedWith || null, after: Date.now() - started };
  }
  console.log(`=== ${label}: ${JSON.stringify(result)}`);
  await instance.close().catch(() => {});
  server.close();
};

(async () => {
  console.log("chrome:", chrome);
  await plain("Chrome alone, its new tab page", []);
  await plain("Chrome alone, about:blank", ["about:blank"]);
  await plain("Chrome alone, a web page", ["https://example.com/"]);
  await plain("Chrome alone, new tab page, --disable-gpu", ["--disable-gpu"]);
  await viaNoor("Noor's ChromeInstance, no protection script", [], false);
  await viaNoor("Noor's ChromeInstance, with the protection", [], true);
  await viaNoor("Noor's ChromeInstance, with the protection, --disable-gpu", ["--disable-gpu"], true);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
