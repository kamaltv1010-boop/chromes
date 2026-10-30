"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const core = require("../extension/core");
const { generated, protectForExtension, pack, extensionFiles, BITS } = require("../tools/build-extension");

const EXTENSION = path.join(__dirname, "..", "extension");
const { KINDS } = core;

test("a new state: a master, canvas and WebGL on, audio and ClientRects off, no site off", () => {
  const state = core.normalize({});
  assert.ok(Number.isInteger(state.master) && state.master >= 0 && state.master <= 0xffffffff);
  assert.deepEqual(state.enabled, { canvas: true, webGL: true, audio: false, clientRects: false });
  assert.deepEqual(state.gens, { canvas: 0, webGL: 0, audio: 0, clientRects: 0 });
  assert.deepEqual(state.offSites, []);
  assert.notEqual(core.normalize({}).master, core.normalize({}).master);
});

test("a kept state is kept, and what is wrong in it made anew", () => {
  const kept = { master: 7, gens: { canvas: 3, webGL: 63, audio: 0, clientRects: 1 }, enabled: { canvas: false, webGL: true, audio: true, clientRects: false }, offSites: ["b.com", "a.com", "a.com"] };
  assert.deepEqual(core.normalize(kept), { ...kept, offSites: ["a.com", "b.com"] });
  const wrong = core.normalize({ master: -1, gens: { canvas: 64, webGL: 1.5 }, enabled: { audio: "yes" }, offSites: ["https://x.com/", "www.y.com", "", "z.org"] });
  assert.ok(wrong.master >= 0);
  assert.equal(wrong.gens.canvas, 0);
  assert.equal(wrong.gens.webGL, 0);
  assert.equal(wrong.enabled.audio, false);
  assert.deepEqual(wrong.offSites, ["z.org"]);
});

test("new values for one protection change it alone; for all, the master", () => {
  const state = core.normalize({ master: 42 });
  const canvas = core.renew(state, ["canvas"]);
  assert.equal(canvas.master, 42);
  assert.deepEqual(canvas.gens, { canvas: 1, webGL: 0, audio: 0, clientRects: 0 });
  assert.equal(state.gens.canvas, 0);
  const all = core.renew(canvas, KINDS);
  assert.notEqual(all.master, 42);
  assert.deepEqual(all.gens, { canvas: 0, webGL: 0, audio: 0, clientRects: 0 });
  // A protection's generations come round: then every protection gets a new master.
  const last = core.normalize({ master: 42, gens: { canvas: core.GENERATIONS - 1 } });
  const round = core.renew(last, ["canvas"]);
  assert.notEqual(round.master, 42);
  assert.equal(round.gens.canvas, 0);
});

test("pages are told the state by which files run, and get the seeds and key from them", () => {
  const state = core.normalize({ master: 0xdeadbeef, gens: { canvas: 5 }, enabled: { canvas: true, webGL: true, audio: false, clientRects: true } });
  const files = core.filesFor(state);
  assert.equal(files[files.length - 1], "realm.js");
  assert.ok(files.slice(0, -1).every((file) => /^bits\/\d+\.js$/.test(file)));
  const config = core.configFrom(core.bitsOf(state));
  assert.deepEqual(Object.keys(config.seeds), KINDS);
  assert.equal(config.seeds.audio, null);
  for (const kind of ["canvas", "webGL", "clientRects"]) {
    assert.ok(Number.isInteger(config.seeds[kind]) && config.seeds[kind] >= 0 && config.seeds[kind] <= 0xffffffff, kind);
  }
  assert.equal(new Set([config.seeds.canvas, config.seeds.webGL, config.seeds.clientRects]).size, 3);
  assert.match(config.key, /^_[0-9a-f]{24}$/);
  assert.equal(config.screen, null);
  assert.equal(config.hardware, null);
  // A protection's new generation changes its seed alone, and not the key.
  const next = core.configFrom(core.bitsOf(core.renew(state, ["canvas"])));
  assert.notEqual(next.seeds.canvas, config.seeds.canvas);
  assert.equal(next.seeds.webGL, config.seeds.webGL);
  assert.equal(next.key, config.key);
  // Another master changes everything.
  const other = core.configFrom(core.bitsOf({ ...state, master: 0xdeadbeee }));
  assert.notEqual(other.key, config.key);
  for (const kind of ["canvas", "webGL", "clientRects"]) assert.notEqual(other.seeds[kind], config.seeds[kind], kind);
});

test("sites are hosts without www., turned off with their subdomains", () => {
  assert.equal(core.siteOf("https://www.Example.com:8443/a?b"), "example.com");
  assert.equal(core.siteOf("http://127.0.0.1:9/"), "127.0.0.1");
  assert.equal(core.siteOf("chrome://extensions/"), null);
  assert.equal(core.siteOf("file:///C:/a.html"), null);
  assert.equal(core.siteOf("nonsense"), null);
  assert.ok(core.isSite("example.com") && !core.isSite("www.example.com") && !core.isSite("a b"));
  assert.deepEqual(core.excludeFor(["example.com", "127.0.0.1", "[::1]"]), ["*://*.example.com/*", "*://127.0.0.1/*", "*://[::1]/*"]);
});

test("the generated files are those the tool makes now", () => {
  for (const [name, text] of Object.entries(generated())) {
    assert.equal(fs.readFileSync(path.join(EXTENSION, name), "utf8").replace(/\r\n/g, "\n"), text, `${name} is out of date: run node tools/build-extension.js`);
  }
  const bits = fs.readdirSync(path.join(EXTENSION, "bits"));
  assert.equal(bits.length, core.BIT_COUNT);
});

test("realm.js takes the bits away before the page runs, compiles nothing from text, and runs protect.js", () => {
  const realm = fs.readFileSync(path.join(EXTENSION, "realm.js"), "utf8");
  new vm.Script(realm);
  assert.ok(!/\beval\b|new Function\(/.test(realm));
  assert.ok(realm.includes("const protectPage = ") && realm.includes("protectPage(window, config)"));
  // The bits' files and realm.js, as the browser runs them, on a page it
  // doesn't protect: the bits are gone all the same.
  const sandbox = { location: { protocol: "chrome:" } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const n of [1, 5, 57]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION, "bits", `${n}.js`), "utf8"), sandbox);
  }
  assert.deepEqual(Array.from(sandbox[BITS]), [1, 5, 57]);
  vm.runInContext(realm, sandbox);
  assert.equal(BITS in sandbox, false);
});

test("an empty page a page opens is keyed on its origin's site, as the page it goes on to", () => {
  const extended = protectForExtension(fs.readFileSync(path.join(__dirname, "..", "scripts", "protect.js"), "utf8").replace(/\r\n/g, "\n"));
  assert.equal(extended.split("window.origin").length, 2);
  assert.ok(!extended.includes("module.exports"));
  assert.throws(() => protectForExtension("const protectPage = () => {};"), /host/);
});

test("the manifest asks for what the extension uses, and its files are there", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  const files = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const file of files) assert.ok(fs.existsSync(path.join(EXTENSION, file)), file);
  for (const file of ["core.js", "popup.js", "popup.css", "realm.js"]) assert.ok(fs.existsSync(path.join(EXTENSION, file)), file);
});

test("every language has every message, and says its direction", () => {
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(EXTENSION, "_locales", lang, "messages.json"), "utf8"));
  const english = read("en");
  const keys = Object.keys(english).sort();
  for (const lang of fs.readdirSync(path.join(EXTENSION, "_locales"))) {
    const messages = read(lang);
    assert.deepEqual(Object.keys(messages).sort(), keys, lang);
    assert.ok(["ltr", "rtl"].includes(messages.dir.message), lang);
  }
  assert.equal(read("ar").dir.message, "rtl");
  // The messages the popup and the manifest use are there.
  const used = new Set();
  for (const file of ["popup.html", "popup.js", "manifest.json"]) {
    const text = fs.readFileSync(path.join(EXTENSION, file), "utf8");
    for (const match of text.matchAll(/data-i18n="(\w+)"|text\("(\w+)"\)|__MSG_(\w+)__/g)) used.add(match[1] || match[2] || match[3]);
  }
  for (const kind of KINDS) used.add(kind).add(`${kind}Hint`);
  for (const key of used) assert.ok(keys.includes(key), key);
});

/// The files of a zip this tool made: name to contents.
const unzip = (buffer) => {
  const files = {};
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extra = buffer.readUInt16LE(at + 28);
    const name = buffer.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extra;
    files[name] = zlib.inflateRawSync(buffer.subarray(start, start + size));
    at = start + size;
  }
  return files;
};

test("the zip is the extension at its version, with a mark of its own", () => {
  const out = pack("1.0.77");
  try {
    const files = unzip(fs.readFileSync(out));
    assert.deepEqual(Object.keys(files), extensionFiles());
    assert.equal(JSON.parse(files["manifest.json"]).version, "1.0.77");
    const realm = files["realm.js"].toString("utf8");
    assert.ok(!realm.includes("noor lookalike"));
    const original = fs.readFileSync(path.join(EXTENSION, "realm.js"), "utf8");
    const mark = realm.match(/\/\* ([0-9a-f]{16}) \*\//)[1];
    assert.equal(realm, original.split("noor lookalike").join(mark));
    assert.deepEqual(files["popup.js"], fs.readFileSync(path.join(EXTENSION, "popup.js")));
    assert.throws(() => pack("v1"), /version/);
  } finally {
    fs.rmSync(out, { force: true });
  }
});
