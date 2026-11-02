"use strict";
// Temporary diagnosis (branch diag-1 only, never merged): why Chrome
// started by the app (Electron) ends with 0x80000003 in under a second on
// Windows, when Chrome started by Node runs. Starts Chrome in several ways
// and says which live.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { _electron: electron } = require("playwright-core");
const root = path.join(__dirname, "..");
const { findChrome } = require(path.join(root, "main", "chrome.js"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = process.env.NOOR_CHROME || findChrome();
const argsFor = (dir, extra = []) => [`--user-data-dir=${dir}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", ...(process.env.NOOR_CHROME_ARGS || "").split(" ").filter(Boolean), ...extra, "about:blank"];

// From this Node process.
const fromNode = (env, extra) => new Promise((resolve) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-node-"));
  const started = Date.now();
  const child = spawn(chrome, argsFor(dir, extra), { stdio: "ignore", env });
  let done = false;
  child.on("exit", (code) => { if (!done) { done = true; resolve({ alive: false, code, after: Date.now() - started, dir }); } });
  setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch (e) {} resolve({ alive: true, dir }); } }, 6000);
});

(async () => {
  console.log("chrome:", chrome);
  console.log("node, own env:", JSON.stringify(await fromNode(process.env)));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "diag-app-"));
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_USER_DATA: userData } });
  for (let i = 0; i < 100; i++) { if (await app.evaluate(() => Boolean(global.noorTest)).catch(() => false)) break; await sleep(100); }
  const appEnv = await app.evaluate(() => process.env);
  const changed = Object.keys(appEnv).filter((k) => process.env[k] !== appEnv[k]);
  const removed = Object.keys(process.env).filter((k) => !(k in appEnv));
  console.log("env the app adds or changes:", JSON.stringify(Object.fromEntries(changed.map((k) => [k, appEnv[k]])), null, 1));
  console.log("env the app removes:", JSON.stringify(removed));

  // From the app's main process (Electron), as ChromeInstance does.
  const fromApp = (env, extra) => app.evaluate(async (e, [exe, args, envGiven]) => {
    const { spawn: start } = process.getBuiltinModule("child_process");
    const fsm = process.getBuiltinModule("fs");
    const osm = process.getBuiltinModule("os");
    const pathm = process.getBuiltinModule("path");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "diag-electron-"));
    const list = args.map((a) => a.replace("DIR", dir));
    return new Promise((resolve) => {
      const started = Date.now();
      const child = start(exe, list, { stdio: "ignore", windowsHide: false, ...(envGiven ? { env: envGiven } : {}) });
      let done = false;
      child.on("exit", (code) => { if (!done) { done = true; resolve({ alive: false, code, after: Date.now() - started, dir }); } });
      child.on("error", (error) => { if (!done) { done = true; resolve({ error: String(error), dir }); } });
      setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch (er) {} resolve({ alive: true, dir }); } }, 6000);
    });
  }, [chrome, argsFor("DIR", extra), env || null]);

  console.log("app, its env:", JSON.stringify(await fromApp(null)));
  console.log("app, Node's env:", JSON.stringify(await fromApp(process.env)));
  console.log("node, the app's env:", JSON.stringify(await fromNode(appEnv)));
  for (const key of changed) {
    console.log(`node, own env + ${key}:`, JSON.stringify(await fromNode({ ...process.env, [key]: appEnv[key] })));
  }
  const logged = await fromApp(null, ["--enable-logging", "--v=1"]);
  console.log("app, its env, logging:", JSON.stringify(logged));
  const log = path.join(logged.dir, "chrome_debug.log");
  if (fs.existsSync(log)) {
    console.log("chrome_debug.log (last 60 lines):\n" + fs.readFileSync(log, "utf8").split(/\r?\n/).slice(-60).join("\n"));
  } else {
    console.log("no chrome_debug.log in", logged.dir, fs.existsSync(logged.dir) ? fs.readdirSync(logged.dir) : "(no folder)");
  }
  await app.close().catch(() => {});
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
