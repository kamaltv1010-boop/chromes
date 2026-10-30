"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ChromeInstance, setWebRTCPolicy, webRTCPolicy } = require("../main/chrome");

const preferences = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "Default", "Preferences"), "utf8"));

test("a profile with a proxy keeps WebRTC to it, and Chrome's other settings stay", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noor-prefs-"));
  assert.equal(webRTCPolicy("socks5://127.0.0.1:1080"), "disable_non_proxied_udp");
  assert.equal(webRTCPolicy(""), "default");
  assert.ok(setWebRTCPolicy(dir, webRTCPolicy("socks5://127.0.0.1:1080")));
  assert.equal(preferences(dir).webrtc.ip_handling_policy, "disable_non_proxied_udp");
  fs.writeFileSync(path.join(dir, "Default", "Preferences"), JSON.stringify({ profile: { name: "Work" }, webrtc: { ip_handling_policy: "disable_non_proxied_udp", other: 1 } }));
  assert.ok(setWebRTCPolicy(dir, webRTCPolicy("")));
  assert.deepEqual(preferences(dir), { profile: { name: "Work" }, webrtc: { ip_handling_policy: "default", other: 1 } });
  // Settings Chrome is writing, or that are damaged, are left alone.
  fs.writeFileSync(path.join(dir, "Default", "Preferences"), "{ not json");
  assert.equal(setWebRTCPolicy(dir, "disable_non_proxied_udp"), false);
  assert.equal(fs.readFileSync(path.join(dir, "Default", "Preferences"), "utf8"), "{ not json");
});

/// An instance whose commands to Chrome are only written down.
const recorded = (options = {}) => {
  const instance = new ChromeInstance(Object.assign({ executable: "chrome", profile: { id: "p", proxy: "" }, dir: "/tmp/p", pageScript: "", workerScript: () => null }, options));
  const sent = [];
  instance.send = (method, params, sessionId) => {
    sent.push({ method, params, sessionId });
    return Promise.resolve({});
  };
  return { instance, sent };
};

test("Chrome shows a tab's page the profile's screen, but on a sign-in site, and frames get it from the page", async () => {
  const { instance, sent } = recorded({ screen: { width: 2560, height: 1440 } });
  const shown = () => sent.filter((c) => c.method.startsWith("Emulation.") && c.method.includes("DeviceMetrics")).map((c) => c.method === "Emulation.setDeviceMetricsOverride" ? `${c.params.screenWidth}x${c.params.screenHeight} ${c.params.width}x${c.params.height}` : "real");
  instance.pages.set("s1", { type: "page", url: "about:blank", targetId: "t1" });
  await instance.showScreen("s1");
  assert.deepEqual(shown(), ["2560x1440 0x0"]);
  instance.navigated("s1", "t1", "https://news.example/");
  instance.navigated("s1", "t1", "https://accounts.google.com/signin");
  instance.navigated("s1", "t1", "https://news.example/later");
  assert.deepEqual(shown(), ["2560x1440 0x0", "real", "2560x1440 0x0"]);
  instance.pages.set("s2", { type: "iframe", url: "https://other.example/", targetId: "t2" });
  await instance.showScreen("s2");
  await instance.setScreen(null);
  assert.deepEqual(shown(), ["2560x1440 0x0", "real", "2560x1440 0x0", "real"]);
});

test("a worker's own workers are held for the protection too", async () => {
  const { instance, sent } = recorded({ workerScript: () => "void 0" });
  instance.connection = { send: (method) => Promise.resolve(method === "Runtime.evaluate" ? { result: { objectId: "g" } } : {}) };
  await instance.setUpWorker("w1", { type: "worker", url: "https://example.com/w.js" });
  await instance.setUpWorker("w2", { type: "service_worker", url: "https://example.com/sw.js" });
  const attach = sent.filter((c) => c.method === "Target.setAutoAttach");
  assert.deepEqual(attach.map((c) => [c.sessionId, c.params.waitForDebuggerOnStart]), [["w1", true]]);
});
