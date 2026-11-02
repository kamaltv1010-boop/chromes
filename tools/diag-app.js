"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): the app's own
// path (a profile's Chrome, then a tab), in a few ways, with Chrome's log.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron: electron } = require("playwright-core");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const attempt = async (label, chromeArgs, off) => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>App</title><body>app</body>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "diag-app-"));
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_TEST_TIMEZONE: "Europe/Paris", NOOR_USER_DATA: userData, NOOR_CHROME_ARGS: (process.platform === "linux" ? "--no-sandbox " : "") + chromeArgs } });
  for (let i = 0; i < 100; i++) { if (await app.evaluate(() => Boolean(global.noorTest)).catch(() => false)) break; await sleep(100); }
  await sleep(1500);
  const result = await app.evaluate(async (e, [url, kinds]) => {
    for (const kind of kinds) global.noorTest.fingerprint.setEnabled(kind, false);
    const profile = global.noorTest.profiles.all()[0];
    const config = global.noorTest.fingerprint.config(profile);
    const dir = global.noorTest.profiles.dir(profile);
    let instance;
    try {
      instance = await global.noorTest.open(profile);
    } catch (error) {
      return { dir, config, failed: "open: " + String(error.message || error) };
    }
    try {
      await instance.open(url);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const page = await instance.evaluate("location.href + ' ' + screen.width + 'x' + screen.height");
      await instance.close();
      return { dir, config, page };
    } catch (error) {
      return { dir, config, failed: String(error.message || error), exitedWith: instance.exitedWith || null };
    }
  }, [base, off]);
  console.log(`=== ${label}: ${JSON.stringify({ args: chromeArgs, off, screen: result.config && result.config.screen, gpu: result.config && result.config.gpu && result.config.gpu.renderer, page: result.page, failed: result.failed, exitedWith: result.exitedWith })}`);
  const log = path.join(result.dir, "chrome_debug.log");
  if (fs.existsSync(log)) {
    const lines = fs.readFileSync(log, "utf8").split(/\r?\n/).filter((line) => !/content_verifier|content_hash|scheduler_loop_quarantine|install_signer/.test(line));
    console.log(`chrome_debug.log, ${lines.length} lines; the last 50:\n` + lines.slice(-50).join("\n"));
  }
  await app.close().catch(() => {});
  server.close();
};

(async () => {
  await attempt("as the app runs it, with Chrome's log", "--enable-logging --v=0", []);
  await attempt("with SwiftShader (as smoke-chrome)", "--enable-unsafe-swiftshader", []);
  await attempt("screen protection off", "", ["screen"]);
  await attempt("gpu protection off", "", ["gpu"]);
  await attempt("screen and gpu off, logging", "--enable-logging --v=0", ["screen", "gpu"]);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
