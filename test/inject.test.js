"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { pageScript, workerScript, hostOfWorker, isSignInSite, NAME, KEY, MARK } = require("../main/inject");
const { blockedFor } = require("../main/trackers");

const config = { seeds: { canvas: 1, webGL: 2, audio: null, clientRects: null }, screen: { width: 2560, height: 1440 }, hardware: { cores: 8, memory: 8 } };

test("the page and worker scripts parse and carry the config", () => {
  const page = pageScript(config);
  new vm.Script(page);
  assert.ok(page.includes('"canvas":1') && page.includes("framesHidden: true") && page.includes("key: KEY"));
  // The protection is the script's own code, made in the hidden frame (or, failing that, here).
  assert.ok(page.includes("const protectPage = ") && page.endsWith(`//# sourceURL=${NAME}`));
  const worker = workerScript(config, "https://example.com/w.js");
  new vm.Script(worker);
  assert.ok(worker.includes('"host":"example.com"') && worker.includes("protectPage(self") && !worker.includes('"framesHidden":true'));
  assert.ok(workerScript(config, "https://example.com/w.js", true).includes('"framesHidden":true'));
});

test("nothing is compiled from text, which a page's policy (CSP) could forbid and report to its site", () => {
  assert.ok(!/\beval\b|new Function\(/.test(pageScript(config)));
});

test("the hidden frame hands the page the protection, made in its own realm", () => {
  const element = { [KEY]: true };
  vm.runInNewContext(pageScript(config), { location: { protocol: "about:" }, window: { frameElement: element } });
  assert.equal(typeof element[KEY], "function");
});

test("a replacement's mark is this run's, which no page knows", () => {
  assert.match(MARK, /^[0-9a-f]{16}$/);
  for (const script of [pageScript(config), workerScript(config, "https://example.com/w.js", true)]) {
    assert.ok(!script.includes("noor lookalike") && script.includes(`/* ${MARK} */`));
  }
});

test("sign-in sites are known by their host", () => {
  assert.ok(isSignInSite("https://accounts.google.com/signin") && isSignInSite("https://www.instagram.com/"));
  assert.ok(!isSignInSite("https://www.google.com/") && !isSignInSite("nonsense"));
});

test("the scripts go by a name of their own for the run, with nothing of the app in it", () => {
  assert.match(NAME, /^[0-9a-f]{12}\.js$/);
  assert.ok(!/noor/i.test(pageScript(config).split("\n").filter((line) => line.startsWith("//# sourceURL=")).join("")));
});

test("Chrome's own pages and extensions' are left alone", () => {
  // The script touches nothing there (no document is given) and throws nothing.
  for (const protocol of ["chrome:", "chrome-extension:", "chrome-search:", "devtools:"]) {
    vm.runInNewContext(pageScript(config), { location: { protocol } });
  }
});

test("a worker's host comes from its script's address, blob: ones included", () => {
  assert.equal(hostOfWorker("https://www.example.com/a/w.js"), "www.example.com");
  assert.equal(hostOfWorker("blob:https://site.test/123-456"), "site.test");
  assert.equal(hostOfWorker("nonsense"), "");
});

test("a sign-in site's worker gets the real screen and hardware", () => {
  const worker = workerScript(config, "https://www.instagram.com/w.js");
  assert.ok(worker.includes('"screen":null') && worker.includes('"hardware":null'));
});

test("trackers are blocked on other sites, not on their own or allowed ones", () => {
  const rules = [{ domain: "facebook.net", allowedOn: ["facebook.com", "instagram.com"] }, { domain: "google-analytics.com", allowedOn: [] }];
  assert.deepEqual(blockedFor("https://news.example/", rules), ["*://facebook.net/*", "*://*.facebook.net/*", "*://google-analytics.com/*", "*://*.google-analytics.com/*"]);
  assert.deepEqual(blockedFor("https://www.instagram.com/", rules), ["*://google-analytics.com/*", "*://*.google-analytics.com/*"]);
  assert.deepEqual(blockedFor("https://cdn.facebook.net/", rules), ["*://google-analytics.com/*", "*://*.google-analytics.com/*"]);
});
