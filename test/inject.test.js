"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { pageScript, workerScript, hostOfWorker } = require("../main/inject");
const { blockedFor } = require("../main/trackers");

const config = { seeds: { canvas: 1, webGL: 2, audio: null, clientRects: null }, screen: { width: 2560, height: 1440 }, hardware: { cores: 8, memory: 8 } };

test("the page and worker scripts parse and carry the config", () => {
  const page = pageScript(config);
  new vm.Script(page);
  assert.ok(page.includes('"canvas":1') && page.includes("protectPage(window"));
  const worker = workerScript(config, "https://example.com/w.js");
  new vm.Script(worker);
  assert.ok(worker.includes('"host":"example.com"') && worker.includes("protectPage(self"));
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
