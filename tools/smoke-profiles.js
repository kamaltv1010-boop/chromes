"use strict";
// Profiles through the app's window: several added at once ("Add
// several…"), numbered after the others; a profile set to be deleted as
// its Chrome closes is, with its folder, once its Chrome has quit, and a
// new one, set the same way, is made in its place with a number of its
// own. Linux, as root, with Chrome for Testing or Chromium:
//   NOOR_CHROME=/path/to/chrome NOOR_CHROME_ARGS=--no-sandbox xvfb-run -a node tools/smoke-profiles.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-profiles-"));
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_TEST_TIMEZONE: "Europe/Paris", NOOR_USER_DATA: userData } });
  const main = (fn, arg) => app.evaluate(fn, arg);
  for (let i = 0; i < 100; i++) { if (await main(() => Boolean(global.noorTest))) break; await sleep(100); }
  const window = await app.firstWindow();
  await sleep(1500);
  const invoke = (channel, ...args) => window.evaluate(([c, a]) => window.noor.invoke(c, ...a).then((r) => r, (e) => ({ error: String(e.message || e) })), [channel, args]);
  const steps = [];
  const step = (name, ok, detail) => { steps.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`); };
  const names = (state) => state.profiles.map((p) => p.name);

  // The window's question (Electron has no prompt): typed into, then OK.
  const answer = async (value) => {
    await window.waitForSelector("dialog#ask[open]", { timeout: 5000 });
    if (value !== null) await window.fill("#ask-value", value);
    await window.click("#ask-ok");
    await sleep(800);
  };
  const shownNames = () => window.evaluate(() => [...document.querySelectorAll(".profile .name")].map((n) => n.firstChild.textContent));
  // A profile's ⋯ menu item, clicked.
  const menu = async (name, item) => {
    await window.evaluate(([n, i]) => {
      const row = [...document.querySelectorAll(".profile")].find((p) => p.querySelector(".name").firstChild.textContent === n);
      row.querySelector(".menu > button").click();
      [...row.querySelectorAll(".menu .items button")].find((b) => b.textContent.includes(i)).click();
    }, [name, item]);
  };

  const before = await invoke("state");
  await window.click("#addmany");
  await answer("3");
  const added = await invoke("state");
  const made = names(added).slice(before.profiles.length);
  step("Add several… (the window's question): three profiles, numbered after the others", made.length === 3 && made.every((name, i) => name === `Profile ${before.profiles.length + 1 + i}`), names(added));
  const shown = await shownNames();
  step("the window lists them", made.every((name) => shown.includes(name)), shown);

  // Rename… and Proxy… through the window (they used prompt, which Electron hasn't).
  await menu(made[0], "Rename");
  await answer("Renamed one");
  await menu("Renamed one", "Proxy");
  await answer("socks5://127.0.0.1:1080");
  const renamed = (await invoke("state")).profiles.find((p) => p.id === added.profiles[before.profiles.length].id);
  step("Rename… and Proxy… work from the menu", renamed.name === "Renamed one" && renamed.proxy === "socks5://127.0.0.1:1080" && (await shownNames()).includes("Renamed one"), renamed);

  const burner = added.profiles[added.profiles.length - 1];
  await menu(burner.name, "Delete when Chrome closes");
  await answer(null);
  const set = await invoke("state");
  step("the last one is set to be deleted as its Chrome closes (menu, then the question)", set.profiles.find((p) => p.id === burner.id).burner === true);
  const dir = await main((e, id) => global.noorTest.profiles.dir(global.noorTest.profiles.find(id)), burner.id);
  await invoke("chrome:open", burner.id);
  await sleep(2000);
  step("its Chrome opens, with its folder", fs.existsSync(dir) && (await main((e, id) => global.noorTest.instances.has(id), burner.id)));
  await invoke("chrome:close", burner.id);
  let after = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    after = await invoke("state");
    if (!after.profiles.some((p) => p.id === burner.id) && after.profiles.length === added.profiles.length) break;
  }
  const replacement = after.profiles[after.profiles.length - 1];
  step("closed, it is deleted with its folder", !after.profiles.some((p) => p.id === burner.id) && !fs.existsSync(dir), { names: names(after), folderLeft: fs.existsSync(dir) });
  step("a new one is in its place, with a number of its own, deleted as it closes too", replacement.id !== burner.id && replacement.name === `Profile ${Number(burner.name.split(" ")[1]) + 1}` && replacement.burner === true, replacement);

  await app.close();
  const ok = steps.every(Boolean);
  console.log(ok ? "PROFILES SMOKE OK" : "PROFILES SMOKE FAILED");
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
