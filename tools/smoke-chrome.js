"use strict";
// Opens Chrome (or Chromium: NOOR_CHROME) through the launcher and checks
// that its pages and workers get the protection, the time zone and the
// blocked trackers. Run: xvfb-run -a node tools/smoke-chrome.js
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ChromeInstance, findChrome } = require("../main/chrome");
const { pageScript, workerScript, NAME } = require("../main/inject");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Smoke</title><style id="mq"></style></head><body><div id="probe" style="width:1px"></div>
<img id="t" src="http://127.0.0.1:PORT/tracked.png?via=google-analytics.com" width="1" height="1">
<script src="https://www.google-analytics.com/analytics.js" onerror="window.gaBlocked = true"></script>
<iframe id="f"></iframe>
</body></html>`;

(async () => {
  const executable = findChrome(process.env.NOOR_CHROME);
  if (!executable) {
    throw new Error("No Chrome found; set NOOR_CHROME");
  }
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith("/tracked.png")) {
      res.setHeader("content-type", "image/png");
      return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    }
    res.setHeader("content-type", "text/html");
    res.end(PAGE.replace("PORT", String(server.address().port)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const config = { seeds: { canvas: 1111, webGL: 2222, audio: null, clientRects: null }, screen: { width: 2560, height: 1440 }, hardware: { cores: 6, memory: 8 } };
  const instance = new ChromeInstance({
    executable,
    profile: { id: "smoke", name: "Smoke", proxy: "" },
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-smoke-")),
    pageScript: pageScript(config),
    workerScript: (url, hidden) => workerScript(config, url, hidden),
    screen: config.screen,
    timezone: "Asia/Tokyo",
    blockTrackers: true,
    extraArgs: (process.env.NOOR_CHROME_ARGS || "").split(" ").filter(Boolean),
  });
  await instance.start();
  await instance.open(base);
  await sleep(3000);
  const probe = `(async () => {
    const worker = await new Promise((resolve) => {
      const code = "postMessage({ cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, toStr: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(WorkerNavigator.prototype, 'hardwareConcurrency').get) })";
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      const timer = setTimeout(() => resolve("timeout"), 5000);
      w.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(timer); resolve("error " + e.message); };
    });
    // A worker's own worker.
    const nested = await new Promise((resolve) => {
      const inner = "postMessage(navigator.hardwareConcurrency)";
      const code = "const w = new Worker(URL.createObjectURL(new Blob([" + JSON.stringify(inner) + "], { type: 'text/javascript' }))); w.onmessage = (e) => postMessage(e.data);";
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      const timer = setTimeout(() => resolve("timeout"), 5000);
      w.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    });
    // The screen as CSS sees it (a media query), not only scripts.
    const css = (query) => { document.getElementById("mq").textContent = "@media " + query + " { #probe { width: 7px !important } }"; const width = getComputedStyle(document.getElementById("probe")).width; document.getElementById("mq").textContent = ""; return width === "7px"; };
    const c = document.createElement("canvas"); c.width = 120; c.height = 40; const ctx = c.getContext("2d"); ctx.font = "16px Arial"; ctx.fillText("Noor ✓", 4, 24);
    const f = document.getElementById("f");
    return {
      title: document.title, screen: screen.width + "x" + screen.height, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(2026, 0, 15).getTimezoneOffset(),
      webdriver: navigator.webdriver, toStr: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Screen.prototype, "width").get),
      frameScreen: f.contentWindow.screen.width, frameCores: f.contentWindow.navigator.hardwareConcurrency,
      canvasURL: c.toDataURL().slice(-24), worker, gaBlocked: window.gaBlocked === true, nested,
      cssScreen: css("(device-width: 2560px) and (device-height: 1440px)"),
      // The page's canvas read through a frame's built-ins, as through its own.
      frameCanvas: f.contentWindow.HTMLCanvasElement.prototype.toDataURL.call(c) === c.toDataURL(),
      // A page's function that carries the iPhone app's mark is a page's function.
      oldMark: Function.prototype.toString.call(function () { /* noor lookalike */ }).includes("native code"),
      // A stack read inside a protected built-in: the page's frames only.
      stack: (() => { let s = ""; ctx.getImageData({ valueOf() { s = new Error().stack; return 0; } }, 0, 1, 1); return s; })(),
    };
  })()`;
  const page = await instance.evaluate(probe);
  // a second page: same canvas on the same site reads the same
  await instance.open(base);
  await sleep(2000);
  console.log(JSON.stringify({ executable, page, requests }, null, 1));
  const ok = page.screen === "2560x1440" && page.cores === 6 && page.memory === 8 && page.zone === "Asia/Tokyo" && page.worker && page.worker.cores === 6 && page.worker.zone === "Asia/Tokyo" && page.frameScreen === 2560 && page.webdriver === false && page.gaBlocked && /native code/.test(page.toStr)
    && page.stack.includes("valueOf") && !page.stack.includes(NAME)
    && page.nested === 6 && page.cssScreen === true && page.frameCanvas === true && page.oldMark === false;
  await instance.close();
  server.close();
  console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
