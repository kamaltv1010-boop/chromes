"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Profiles } = require("../main/profiles");
const { Fingerprint, KINDS } = require("../main/fingerprint");
const { tempStore } = require("./helpers");

const make = () => {
  const store = tempStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noor-chrome-test-"));
  const profiles = new Profiles(store, root);
  const fingerprint = new Fingerprint(store, profiles);
  fingerprint.realScreen = { width: 1280, height: 800 };
  return { store, root, profiles, fingerprint };
};

test("profiles are added, renamed, given a proxy and removed with their folder", () => {
  const { profiles } = make();
  assert.deepEqual(profiles.all(), []);
  const a = profiles.add("Work");
  const b = profiles.add("");
  assert.equal(b.name, "Profile 2");
  profiles.rename(a.id, " Office ");
  profiles.setProxy(a.id, "socks5://127.0.0.1:1080");
  assert.equal(profiles.find(a.id).name, "Office");
  assert.equal(profiles.find(a.id).proxy, "socks5://127.0.0.1:1080");
  fs.mkdirSync(profiles.dir(a), { recursive: true });
  fs.writeFileSync(path.join(profiles.dir(a), "Cookies"), "x");
  profiles.remove(a.id);
  assert.equal(profiles.find(a.id), null);
  assert.equal(fs.existsSync(profiles.dir(a)), false);
  assert.deepEqual(profiles.all().map((p) => p.name), ["Profile 2"]);
});

test("each profile has its own seeds, kept, and new ones differ", () => {
  const { profiles, fingerprint } = make();
  const a = profiles.add("A");
  const b = profiles.add("B");
  const seedA = fingerprint.seed("canvas", a);
  assert.equal(fingerprint.seed("canvas", a), seedA);
  assert.notEqual(fingerprint.seed("canvas", b), seedA);
  const screen = fingerprint.visibleValue(fingerprint.seed("screen", a), "screen");
  fingerprint.newSeed("screen", a);
  assert.notEqual(fingerprint.visibleValue(fingerprint.seed("screen", a), "screen"), screen);
  profiles.remove(a.id);
  assert.notEqual(fingerprint.seed("canvas", a), seedA, "a removed profile's seeds are gone");
});

test("config: noise seeds for what is on (audio and ClientRects off at first), a screen at least this PC's", () => {
  const { profiles, fingerprint } = make();
  const a = profiles.add("A");
  const config = fingerprint.config(a);
  assert.ok(Number.isInteger(config.seeds.canvas));
  assert.ok(Number.isInteger(config.seeds.webGL));
  assert.equal(config.seeds.audio, null);
  assert.equal(config.seeds.clientRects, null);
  assert.ok(config.screen.width >= 1280 && config.screen.height >= 800);
  assert.equal(config.hardware.memory, 8);
  fingerprint.setEnabled("screen", false);
  assert.equal(fingerprint.config(a).screen, null);
  assert.deepEqual(KINDS, ["canvas", "webGL", "gpu", "audio", "clientRects", "screen", "hardware", "fonts"]);
});

test("WebGL Vendor & Renderer: a common PC's card, as Chrome on Windows names it, its own for each profile; off, none", () => {
  const { profiles, fingerprint } = make();
  const a = profiles.add("A");
  const { gpu } = fingerprint.config(a);
  assert.match(gpu.vendor, /^Google Inc\. \((NVIDIA|Intel|AMD)\)$/);
  assert.match(gpu.renderer, /^ANGLE \((NVIDIA|Intel|AMD), .+ \(0x[0-9A-F]{8}\) Direct3D11 vs_5_0 ps_5_0, D3D11\)$/);
  assert.match(gpu.webgpu.vendor, /^(nvidia|intel|amd)$/);
  assert.equal(fingerprint.shown(a).gpu, fingerprint.gpu(a).name);
  // New gives another card (there is another to pick).
  const before = fingerprint.visibleValue(fingerprint.seed("gpu", a), "gpu");
  fingerprint.newSeed("gpu", a);
  assert.notEqual(fingerprint.visibleValue(fingerprint.seed("gpu", a), "gpu"), before);
  fingerprint.setEnabled("gpu", false);
  assert.equal(fingerprint.config(a).gpu, null);
  assert.equal(fingerprint.shown(a).gpu, null);
});

test("Fonts: Windows' own and the profile's own others shown, this PC's other fonts hidden; New picks others; off, none", () => {
  const { FontList } = require("../main/fonts");
  const { profiles, fingerprint } = make();
  const a = profiles.add("A");
  // Before this PC's fonts are known, pages get none of it.
  assert.equal(fingerprint.config(a).fonts, null);
  assert.equal(fingerprint.shown(a).fonts, null);
  // This PC: Windows' own, and a font of another program's.
  fingerprint.fontList = new FontList(null, { faces: [["Arial", "Arial", "ArialMT", "Regular"], ["Segoe UI", "Segoe UI", "SegoeUI", "Regular"], ["Inconsolata", "Inconsolata Regular", "Inconsolata-Regular", "Regular"]] });
  const { fonts } = fingerprint.config(a);
  assert.ok(fonts.shadow.includes("Inconsolata"), "a font of this PC's no Windows has is hidden");
  assert.ok(!fonts.shadow.includes("Arial") && !fonts.shadow.includes("Segoe UI"), "Windows' own are kept");
  assert.ok(fonts.local.includes("inconsolata-regular"), "and local() finds it by none of its names");
  for (const font of fonts.added) {
    assert.deepEqual(Object.keys(font).sort(), ["kind", "name", "sizeAdjust", "standIn"]);
  }
  const shown = fingerprint.shown(a).fonts;
  assert.deepEqual(Object.keys(shown).sort(), ["drawn", "groups", "hidden", "singles"]);
  assert.equal(shown.hidden, 1);
  // New gives other picks.
  const before = fingerprint.visibleValue(fingerprint.seed("fonts", a), "fonts");
  fingerprint.newSeed("fonts", a);
  assert.notEqual(fingerprint.visibleValue(fingerprint.seed("fonts", a), "fonts"), before);
  fingerprint.setEnabled("fonts", false);
  assert.equal(fingerprint.config(a).fonts, null);
  assert.equal(fingerprint.shown(a).fonts, null);
});

test("with screen or hardware protection off, a profile shows this PC's own, as its pages see them", () => {
  const { profiles, fingerprint } = make();
  fingerprint.realHardware = { cores: 4, memory: 8 };
  const a = profiles.add("A");
  const on = fingerprint.shown(a);
  assert.deepEqual(on.screen, fingerprint.screen(a));
  assert.deepEqual(on.hardware, fingerprint.hardware(a));
  assert.equal(on.realScreen || on.realHardware, false);
  fingerprint.setEnabled("screen", false);
  fingerprint.setEnabled("hardware", false);
  assert.deepEqual(fingerprint.shown(a), { screen: { width: 1280, height: 800 }, hardware: { cores: 4, memory: 8 }, realScreen: true, realHardware: true, gpu: fingerprint.gpu(a).name, fonts: null });
});

test("this PC's memory as Chrome tells pages: the nearest power of two, from 0.25 to 8 GB", () => {
  const { deviceMemory } = require("../main/fingerprint");
  const gb = 1024 ** 3;
  assert.deepEqual([0.1, 0.5, 3, 4, 6, 7.8, 16, 64].map((n) => deviceMemory(n * gb)), [0.25, 0.5, 2, 4, 4, 8, 8, 8]);
});

test("unnamed profiles get the next number, never a deleted one's; a profile may be deleted as its Chrome closes", () => {
  const { profiles } = make();
  const a = profiles.add("");
  const b = profiles.add("");
  assert.deepEqual([a.name, b.name], ["Profile 1", "Profile 2"]);
  profiles.remove(b.id);
  // Made in place of Profile 2: a number of its own.
  const c = profiles.add("", { burner: true });
  assert.equal(c.name, "Profile 3");
  assert.equal(profiles.find(c.id).burner, true);
  assert.equal(profiles.find(a.id).burner, false);
  profiles.setBurner(a.id, true);
  assert.equal(profiles.find(a.id).burner, true);
  profiles.setBurner(a.id, false);
  assert.equal(profiles.find(a.id).burner, false);
  // Several at once, oldest first, in order.
  const many = [1, 2, 3].map(() => profiles.add(""));
  assert.deepEqual(many.map((p) => p.name), ["Profile 4", "Profile 5", "Profile 6"]);
  assert.deepEqual(profiles.all().map((p) => p.name), ["Profile 1", "Profile 3", "Profile 4", "Profile 5", "Profile 6"]);
});
