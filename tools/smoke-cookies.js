"use strict";
// A profile's cookies, through the app's window as a user reaches them:
// a site sets cookies in profile A's Chrome; with that Chrome closed, the
// window lists them (Chrome started with no window, then closed), exports
// them to cookies.txt, deletes the site's, imports the file back; profile
// B sees none of them; A's Chrome opens as usual after. Linux, as root,
// with Chrome for Testing or Chromium:
//   NOOR_CHROME=/path/to/chrome NOOR_CHROME_ARGS=--no-sandbox xvfb-run -a node tools/smoke-cookies.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { _electron: electron } = require("playwright");
const root = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("set-cookie", ["noor_a=1; Path=/; Max-Age=86400", "noor_b=two; Path=/; HttpOnly; Max-Age=86400"]);
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><title>cookies</title><p>cookies set</p>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-cookies-"));
  const file = path.join(userData, "exported cookies.txt");
  const app = await electron.launch({ executablePath: require(path.join(root, "node_modules", "electron")), args: [root, "--no-sandbox"], env: { ...process.env, NOOR_TEST: "1", NOOR_TEST_TIMEZONE: "Europe/Paris" } });
  await app.evaluate(({ app }, dir) => app.setPath("userData", dir), userData).catch(() => {});
  const main = (fn, arg) => app.evaluate(fn, arg);
  for (let i = 0; i < 100; i++) { if (await main(() => Boolean(global.noorTest))) break; await sleep(100); }
  const window = await app.firstWindow();
  await sleep(1500);
  // As the window's buttons call them.
  const invoke = (channel, ...args) => window.evaluate(([c, a]) => window.noor.invoke(c, ...a).then((r) => r, (e) => ({ error: String(e.message || e) })), [channel, args]);
  const steps = [];
  const step = (name, ok, detail) => { steps.push({ name, ok }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`); };
  const names = (answer) => (answer && answer.sites ? answer.sites.flatMap((s) => s.cookies.map((c) => `${s.site} ${c.name}${c.httpOnly ? " (HttpOnly)" : ""}`)).sort() : answer);

  const [a, b] = await main(() => {
    const all = global.noorTest.profiles.all();
    const second = all.length > 1 ? all[1] : global.noorTest.profiles.add("B");
    return [all[0].id, second.id];
  });
  // 1. A site sets two cookies in A's Chrome, which is then closed.
  await main(async (e, [id, url]) => {
    const instance = await global.noorTest.open(global.noorTest.profiles.find(id));
    await instance.open(url);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await instance.close();
  }, [a, base]);
  await sleep(1500);
  const closed = await main((e, id) => !global.noorTest.instances.has(id), a);
  step("profile A's Chrome is closed", closed);

  // 2. Listed with Chrome closed: started with no window, closed again.
  const listed = await invoke("cookies:list", a);
  step("the window lists the site's two cookies (no value)", JSON.stringify(names(listed)) === JSON.stringify(["127.0.0.1 noor_a", "127.0.0.1 noor_b (HttpOnly)"]) && !JSON.stringify(listed).includes("two"), names(listed));
  const after = await main((e, id) => ({ running: global.noorTest.instances.has(id), busy: global.noorTest.busy.has(id) }), a);
  step("Chrome started for the list is gone again", !after.running && !after.busy, after);

  // 3. Exported to cookies.txt.
  await main((e, f) => { global.noorTest.nextFile = f; }, file);
  const exported = await invoke("cookies:export", a, "txt");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  step("exported to cookies.txt (HttpOnly kept)", exported.count === 2 && /\tnoor_a\t1$/m.test(text) && /^#HttpOnly_127\.0\.0\.1\t.*\tnoor_b\ttwo$/m.test(text), exported);

  // 4. The site's cookies deleted.
  const cleared = await invoke("cookies:clear", a, "127.0.0.1");
  const empty = await invoke("cookies:list", a);
  step("the site's cookies deleted", cleared.count === 2 && empty.count === 0, { cleared, left: names(empty) });

  // 5. Imported back from the file.
  await main((e, f) => { global.noorTest.nextFile = f; }, file);
  const imported = await invoke("cookies:import", a);
  const back = await invoke("cookies:list", a);
  step("imported back from the file", imported.count === 2 && JSON.stringify(names(back)) === JSON.stringify(names(listed)), { imported, back: names(back) });

  // 6. Profile B has none of them.
  const other = await invoke("cookies:list", b);
  step("profile B has none of A's cookies", other.count === 0, names(other));

  // 7. A's Chrome opens as usual, its page sending the imported cookies.
  const sent = await main(async (e, [id, url]) => {
    const instance = await global.noorTest.open(global.noorTest.profiles.find(id));
    await instance.open(url);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const cookie = await instance.evaluate("document.cookie");
    await instance.close();
    return cookie;
  }, [a, base]).catch((error) => "ERR " + error.message);
  step("A's Chrome opens after, and its page has the cookie", /noor_a=1/.test(sent), sent);

  await app.close();
  server.close();
  const ok = steps.every((s) => s.ok);
  console.log(ok ? "COOKIES SMOKE OK" : "COOKIES SMOKE FAILED");
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
