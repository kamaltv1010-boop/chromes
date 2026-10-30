"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const template = require("../main/template");

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

const STORE_ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm";
const UNPACKED_ID = "blcbecamldhlcedmecdolcjgbabddkdc";
const COMPONENT_ID = "nkeimhogjdpnpccoofpliimaahmaaome";
const DEFAULT_ID = "ghbmnnjooekpmoecnnnilnnbdlolhkhi";

/// A template's folder as Chrome leaves it on Windows: the signed record
/// in Secure Preferences, the rest in Preferences, an extension from the
/// Web Store (its files under Extensions), one from a folder, one of
/// Chrome's own and a default one, and some of the profile's browsing.
const makeTemplate = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noor-template-"));
  const dir = path.join(root, "template");
  const unpackedDir = path.join(root, "my-extension");
  write(path.join(unpackedDir, "manifest.json"), { manifest_version: 3, name: "My Extension", version: "0.3" });
  const storeFiles = path.join(dir, "Default", "Extensions", STORE_ID, "1.62.0_0");
  write(path.join(storeFiles, "manifest.json"), { manifest_version: 3, name: "__MSG_extName__", version: "1.62.0", default_locale: "en" });
  write(path.join(storeFiles, "_locales", "en", "messages.json"), { extname: { message: "uBlock Origin" } });
  write(path.join(dir, "Default", "Extensions", "Temp", "half-installed"), "x");
  write(path.join(dir, "Default", "Secure Preferences"), {
    extensions: {
      settings: {
        [STORE_ID]: { location: 1, path: `${STORE_ID}/1.62.0_0`, disable_reasons: [], from_webstore: true },
        [UNPACKED_ID]: { location: 4, path: unpackedDir, disable_reasons: [1] },
        [COMPONENT_ID]: { location: 5, path: "/opt/chrome/resources/hangout_services" },
        [DEFAULT_ID]: { location: 1, path: `${DEFAULT_ID}/1.0_0`, was_installed_by_default: true },
      },
    },
    protection: { macs: { extensions: { settings: { [STORE_ID]: "A1" } } }, super_mac: "B2" },
  });
  write(path.join(dir, "Default", "Preferences"), {
    extensions: { settings: { [STORE_ID]: { active_bit: false } }, ui: { developer_mode: true } },
    google: { services: { signin_scoped_device_id: "template-device", account_id: "kept" } },
    media_router: { receiver_id_hash_token: "template-token" },
    profile: { name: "Your Chrome", exit_type: "Crashed", content_settings: { exceptions: { notifications: { "https://chromewebstore.google.com:443,*": { setting: 1 } } } } },
  });
  write(path.join(dir, "Default", "Local Extension Settings", STORE_ID, "000003.log"), "storage");
  write(path.join(dir, "Default", "Local Extension Settings", STORE_ID, "LOCK"), "");
  write(path.join(dir, "Default", "Extension Rules", "000001.log"), "rules");
  write(path.join(dir, "Default", "IndexedDB", `chrome-extension_${STORE_ID}_0.indexeddb.leveldb`, "CURRENT"), "x");
  write(path.join(dir, "Default", "IndexedDB", "https_example.com_0.indexeddb.leveldb", "CURRENT"), "x");
  for (const own of ["Cookies", "History", "Login Data", "Web Data"]) write(path.join(dir, "Default", own), "the template's own");
  write(path.join(dir, "Default", "Local Storage", "leveldb", "000003.log"), "sites");
  write(path.join(dir, "Local State"), {
    os_crypt: { encrypted_key: "RFBBUEk=", app_bound_encrypted_key: "QVBQQg==" },
    user_experience_metrics: { low_entropy_source3: 1234, client_id2: "template-client" },
    variations_seed: "seed",
    profile: { info_cache: { Default: { name: "Your Chrome" } } },
  });
  return { root, dir };
};

test("the template's extensions are the user's: from the Web Store or a folder, named as they show", () => {
  const { dir } = makeTemplate();
  assert.deepEqual(template.installedExtensions(dir), [
    { id: UNPACKED_ID, name: "My Extension", version: "0.3", enabled: false, unpacked: true },
    { id: STORE_ID, name: "uBlock Origin", version: "1.62.0", enabled: true, unpacked: false },
  ]);
  assert.deepEqual(template.installedExtensions(path.join(dir, "missing")), []);
});

test("a new profile gets the extensions, their settings and data, and nothing of the template's browsing", () => {
  const { root, dir } = makeTemplate();
  const profileDir = path.join(root, "profiles", "new");
  const copied = template.copyInto(dir, profileDir);
  assert.deepEqual(copied.map((e) => e.id), [UNPACKED_ID, STORE_ID]);
  const has = (rel) => fs.existsSync(path.join(profileDir, "Default", rel));
  assert.ok(has(`Extensions/${STORE_ID}/1.62.0_0/manifest.json`) && has(`Local Extension Settings/${STORE_ID}/000003.log`) && has("Extension Rules/000001.log"));
  assert.ok(has(`IndexedDB/chrome-extension_${STORE_ID}_0.indexeddb.leveldb/CURRENT`));
  assert.ok(!has("IndexedDB/https_example.com_0.indexeddb.leveldb"), "sites' data stays");
  for (const own of ["Cookies", "History", "Login Data", "Web Data", "Local Storage", "Extensions/Temp", `Local Extension Settings/${STORE_ID}/LOCK`]) {
    assert.ok(!has(own), own);
  }
  // The signed record, exactly as Chrome wrote it.
  assert.equal(fs.readFileSync(path.join(profileDir, "Default", "Secure Preferences"), "utf8"), fs.readFileSync(path.join(dir, "Default", "Secure Preferences"), "utf8"));
  const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, "Default", "Preferences"), "utf8"));
  assert.equal(prefs.google.services.signin_scoped_device_id, undefined);
  assert.equal(prefs.google.services.account_id, "kept");
  assert.equal(prefs.media_router.receiver_id_hash_token, undefined);
  assert.equal(prefs.profile.content_settings.exceptions, undefined);
  assert.equal(prefs.profile.exit_type, "Normal");
  assert.equal(prefs.extensions.ui.developer_mode, true);
  // Only the key the record's signatures and the data are encrypted with.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profileDir, "Local State"), "utf8")), { os_crypt: { encrypted_key: "RFBBUEk=", app_bound_encrypted_key: "QVBQQg==" } });
});

test("a profile Chrome has opened, or a template with no extensions, is left as it is", () => {
  const { root, dir } = makeTemplate();
  const opened = path.join(root, "profiles", "opened");
  write(path.join(opened, "Default", "Preferences"), { mine: true });
  assert.deepEqual(template.copyInto(dir, opened), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(opened, "Default", "Preferences"), "utf8")), { mine: true });
  const empty = path.join(root, "empty-template");
  write(path.join(empty, "Default", "Preferences"), { extensions: { settings: {} } });
  const fresh = path.join(root, "profiles", "fresh");
  assert.deepEqual(template.copyInto(empty, fresh), []);
  assert.equal(fs.existsSync(fresh), false);
});

test("the template is a profile of its own, apart from the user's", () => {
  const profile = template.templateProfile();
  assert.equal(profile.id, template.TEMPLATE_ID);
  assert.equal(profile.proxy, "");
  assert.equal(template.localStateForCopy({ variations_seed: "x" }), null);
});

test("a copy that fails leaves the new profile as it was, and says why", { skip: process.platform === "win32" }, () => {
  const { root, dir } = makeTemplate();
  // A file Node can't copy (a pipe), as a file Chrome holds open would be.
  require("child_process").execFileSync("mkfifo", [path.join(dir, "Default", "Extension Rules", "held")]);
  const profileDir = path.join(root, "profiles", "failing");
  assert.throws(() => template.copyInto(dir, profileDir));
  assert.equal(fs.existsSync(profileDir), false);
  assert.equal(fs.existsSync(`${profileDir}.copying`), false);
});

test("a profile's extensions are read again once Chrome rewrites its record", () => {
  const { dir } = makeTemplate();
  assert.equal(template.installedExtensions(dir).length, 2);
  const file = path.join(dir, "Default", "Secure Preferences");
  const prefs = JSON.parse(fs.readFileSync(file, "utf8"));
  delete prefs.extensions.settings[UNPACKED_ID];
  fs.writeFileSync(file, JSON.stringify(prefs, null, 1));
  assert.deepEqual(template.installedExtensions(dir).map((e) => e.id), [STORE_ID]);
});
