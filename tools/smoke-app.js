"use strict";
// Starts the app (Electron) itself, opens Chrome for a profile through it
// and checks a page. Run: xvfb-run -a node tools/smoke-app.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron: electron } = require("playwright-core");
const { fontsFor } = require("../main/fonts");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><html><head><meta charset=utf-8><title>App</title></head><body>app</body></html>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-app-"));
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_TEST_TIMEZONE: "Europe/Paris", NOOR_USER_DATA: userData } });
  const main = (fn, arg) => app.evaluate(fn, arg);
  for (let i = 0; i < 100; i++) { if (await main(() => Boolean(global.noorTest))) break; await sleep(100); }
  const window = await app.firstWindow();
  await sleep(1500);
  // This PC's fonts, as the window's page told the app (see main/fonts.js),
  // and a fonts seed for the profile that shows a font this PC lacks, and
  // hides one it has if it has any no Windows has.
  let faces = null;
  for (let i = 0; i < 100 && !faces; i++) { faces = await main(() => (global.noorTest.fontList.known ? global.noorTest.fontList.faces : null)); if (!faces) await sleep(100); }
  let fontsSeed = null;
  for (let seed = 1; faces && seed < 2000 && fontsSeed === null; seed++) {
    if (fontsFor(seed, faces).added.length) fontsSeed = seed;
  }
  const expectedFonts = fontsSeed === null ? null : fontsFor(fontsSeed, faces);
  if (fontsSeed !== null) await main((e, seed) => { const p = global.noorTest.profiles.all()[0]; global.noorTest.store.set(global.noorTest.profiles.key("seed.fonts", p), seed); }, fontsSeed);
  const ui = await window.evaluate(() => ({ title: document.title, profiles: [...document.querySelectorAll(".profile .name")].map((n) => n.firstChild.textContent), chrome: document.getElementById("chromepath").textContent }));
  console.log("UI:", JSON.stringify(ui));
  const result = await main(async (e, url) => {
    const profile = global.noorTest.profiles.all()[0];
    const instance = await global.noorTest.open(profile);
    try {
      await instance.open(url);
    } catch (error) {
      // What became of Chrome, for the log: closed, how its process ended,
      // and whether its debugging port still answers (Chrome started again
      // by itself, out of Noor's hands).
      let port = "no answer";
      try { port = (await (await fetch(`http://127.0.0.1:${instance.port}/json/version`)).json()).Browser || "answers"; } catch (e) {}
      return { failed: String(error.message || error), closed: instance.closed, exitedWith: instance.exitedWith || null, port };
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const page = await instance.evaluate("({ title: document.title, screen: screen.width + 'x' + screen.height, cores: navigator.hardwareConcurrency, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, webdriver: navigator.webdriver })");
    // Fonts: a font the profile shows that this PC lacks is found; one of
    // this PC's it hides (if any) isn't; the page's own font list is empty.
    const fonts = global.noorTest.fingerprint.config(profile).fonts;
    page.fonts = fonts ? await instance.evaluate(`(async () => {
      await document.fonts.ready;
      const width = (family) => { const s = document.createElement("span"); s.style.cssText = "position:absolute;font-size:72px;white-space:nowrap"; s.style.fontFamily = family; s.textContent = "mmmmmmmmmmlli WwQq@"; document.body.appendChild(s); const w = s.offsetWidth; s.remove(); return w; };
      const found = (name) => width(JSON.stringify(name) + ", monospace") !== width("monospace");
      return { added: ${JSON.stringify((fonts.added[0] || {}).name || null)}, addedFound: ${JSON.stringify((fonts.added[0] || {}).name || "")} ? found(${JSON.stringify((fonts.added[0] || {}).name || "")}) : null,
        hidden: ${JSON.stringify(fonts.shadow[0] || null)}, hiddenFound: ${JSON.stringify(fonts.shadow[0] || "")} ? found(${JSON.stringify(fonts.shadow[0] || "")}) : null, listed: document.fonts.size };
    })()`) : null;
    const state = global.noorTest.state();
    await instance.close();
    return { page, running: state.profiles[0].running, shownFonts: state.profiles[0].fonts, expected: { screen: state.profiles[0].screen, cores: state.profiles[0].hardware.cores } };
  }, base);
  console.log(JSON.stringify(result, null, 1));
  // (The fonts: known from the window's page; the seed's font this PC lacks
  // found in Chrome's page, a font hidden not found, none listed.)
  const fontsOk = Boolean(faces && faces.length) && expectedFonts && result.page && result.page.fonts
    && result.page.fonts.added === expectedFonts.added[0].name && result.page.fonts.addedFound === true
    && (result.page.fonts.hidden === null || result.page.fonts.hiddenFound === false) && result.page.fonts.listed === 0
    && result.shownFonts && result.shownFonts.drawn === expectedFonts.added.length;
  console.log("fonts:", JSON.stringify({ faces: faces ? faces.length : null, seed: fontsSeed, page: result.page && result.page.fonts, shown: result.shownFonts, ok: Boolean(fontsOk) }));
  const ok = !result.failed && fontsOk && result.page.screen === `${result.expected.screen.width}x${result.expected.screen.height}` && result.page.cores === result.expected.cores && result.page.zone === "Europe/Paris" && result.page.webdriver === false && result.running === true;
  await app.close();
  server.close();
  console.log(ok ? "APP SMOKE OK" : "APP SMOKE FAILED");
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
