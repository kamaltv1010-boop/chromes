"use strict";
// Starts the app (Electron) itself, opens Chrome for a profile through it
// and checks a page. Run: xvfb-run -a node tools/smoke-app.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron: electron } = require("playwright");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><html><head><meta charset=utf-8><title>App</title></head><body>app</body></html>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-app-"));
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_TEST_TIMEZONE: "Europe/Paris" } });
  await app.evaluate(({ app }, dir) => app.setPath("userData", dir), userData).catch(() => {});
  const main = (fn, arg) => app.evaluate(fn, arg);
  for (let i = 0; i < 100; i++) { if (await main(() => Boolean(global.noorTest))) break; await sleep(100); }
  const window = await app.firstWindow();
  await sleep(1500);
  const ui = await window.evaluate(() => ({ title: document.title, profiles: [...document.querySelectorAll(".profile .name")].map((n) => n.firstChild.textContent), chrome: document.getElementById("chromepath").textContent }));
  console.log("UI:", JSON.stringify(ui));
  const result = await main(async (e, url) => {
    const profile = global.noorTest.profiles.all()[0];
    const instance = await global.noorTest.open(profile);
    await instance.open(url);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const page = await instance.evaluate("({ title: document.title, screen: screen.width + 'x' + screen.height, cores: navigator.hardwareConcurrency, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, webdriver: navigator.webdriver })");
    const state = global.noorTest.state();
    await instance.close();
    return { page, running: state.profiles[0].running, expected: { screen: state.profiles[0].screen, cores: state.profiles[0].hardware.cores } };
  }, base);
  console.log(JSON.stringify(result, null, 1));
  const ok = result.page.screen === `${result.expected.screen.width}x${result.expected.screen.height}` && result.page.cores === result.expected.cores && result.page.zone === "Europe/Paris" && result.page.webdriver === false && result.running === true;
  await app.close();
  server.close();
  console.log(ok ? "APP SMOKE OK" : "APP SMOKE FAILED");
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
