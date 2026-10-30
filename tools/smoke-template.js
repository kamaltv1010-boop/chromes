"use strict";
// Starts the app with a template in which test/fixtures/template-extension
// was installed (a Chrome profile folder, given as the argument: open Chrome
// on it, Developer mode, Load unpacked, that folder), adds a profile through
// the app's window, opens Chrome for it and checks the extension is there
// and running, its service worker too, with Noor's protection. Linux, as
// root, with Chrome for Testing:
//   NOOR_CHROME=/path/to/chrome NOOR_CHROME_ARGS=--no-sandbox \
//     xvfb-run -a node tools/smoke-template.js /path/to/template
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seed = process.argv[2];

(async () => {
  if (!seed || !fs.existsSync(path.join(seed, "Default", "Preferences"))) {
    throw new Error("Give a template: a Chrome profile folder with an extension installed");
  }
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><html><head><title>Page</title></head><body>page</body></html>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-config-"));
  const userData = path.join(config, "Noor for Chrome");
  fs.cpSync(seed, path.join(userData, "profiles", "template"), { recursive: true, filter: (p) => !/Singleton/.test(path.basename(p)) });
  const app = await electron.launch({
    executablePath: require(path.join(root, "node_modules", "electron")),
    args: [root, "--no-sandbox"],
    env: { ...process.env, NOOR_TEST: "1", XDG_CONFIG_HOME: config },
  });
  const window = await app.firstWindow();
  await window.waitForSelector("#template .row");
  const shown = await window.evaluate(() => [...document.querySelectorAll("#template .row .label")].map((l) => l.firstChild.textContent));
  console.log("template in the window:", JSON.stringify(shown));
  // The template's Chrome open, as after adding extensions to it: adding a
  // profile closes it first.
  const opened = await window.evaluate(() => noor.invoke("chrome:open", "template"));
  const state = await window.evaluate(() => noor.invoke("profiles:add", "Copied"));
  console.log("template open, then closed for the copy:", opened.template.running, !state.template.running);
  const profile = state.profiles.find((p) => p.name === "Copied");
  await window.evaluate((id) => noor.invoke("chrome:open", id), profile.id);
  const seen = await app.evaluate(async (e, [id, url]) => {
    const instance = global.noorTest.instances.get(id);
    await instance.open(url);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return instance.evaluate("({ ext: document.documentElement.getAttribute('data-pipe-ext'), sw: document.documentElement.getAttribute('data-pipe-sw'), webdriver: navigator.webdriver, screen: screen.width + 'x' + screen.height, toDataURL: Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL) })");
  }, [profile.id, `http://127.0.0.1:${server.address().port}/`]);
  console.log("the new profile's page:", JSON.stringify(seen));
  const expected = `${profile.screen.width}x${profile.screen.height}`;
  await window.evaluate((id) => noor.invoke("chrome:close", id), profile.id);
  await app.close();
  server.close();
  const ok = shown.some((s) => /extension/.test(s)) && opened.template.running && !state.template.running && seen.ext === "1" && seen.sw === "pong" && seen.webdriver === false && seen.screen === expected && seen.toDataURL === "function toDataURL() { [native code] }";
  console.log(ok ? "TEMPLATE SMOKE OK" : `TEMPLATE SMOKE FAILED (expected screen ${expected})`);
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
