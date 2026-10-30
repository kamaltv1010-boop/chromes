"use strict";
const fs = require("fs");
const path = require("path");

/// Extensions for new profiles: a profile of its own, the template, where
/// extensions are installed as in any Chrome (the Chrome Web Store, or
/// Developer mode › Load unpacked). A profile added afterwards starts with
/// the template's extensions, their settings and their data. Chrome lets no
/// other program install an extension, and keeps its record of a profile's
/// extensions signed, so that record is copied as Chrome wrote it, whole:
/// Chrome takes the copy as its own. What is the profile's own and not the
/// extensions' (cookies, history, logins, sites' data) isn't copied, and
/// the ids Chrome keeps loose in it are left out, for Chrome to make anew.

const TEMPLATE_ID = "template";

/// The template, as a profile Noor opens Chrome for.
const templateProfile = () => ({ id: TEMPLATE_ID, name: "Extensions for new profiles", proxy: "", created: 0 });

/// What a profile's folder (Default) keeps of its extensions.
const EXTENSION_PARTS = [
  // Chrome's record of the extensions, with the profile's settings, signed
  // (on Windows the signed part is in Secure Preferences).
  "Preferences",
  "Secure Preferences",
  // The files of extensions installed from the Web Store or a .crx.
  "Extensions",
  "Extension State",
  // An extension's dynamic rules (declarativeNetRequest) and the scripts it
  // registers.
  "Extension Rules",
  "Extension Scripts",
  // chrome.storage, and the extensions' own cookies.
  "Local Extension Settings",
  "Sync Extension Settings",
  "Managed Extension Settings",
  "Extension Cookies",
  "Extension Cookies-journal",
];

/// Ids Chrome keeps in Preferences, unsigned, that are the profile's own:
/// left out of a copy, Chrome makes new ones.
const OWN_IDS = [
  ["google", "services", "signin_scoped_device_id"],
  ["media_router", "receiver_id_hash_token"],
  ["account_info"],
  ["gaia_cookie"],
  // Sites' permissions in the template (the Web Store's).
  ["profile", "content_settings", "exceptions"],
];

const readJSON = (file) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
};

/// Where Chrome installed an extension: from the Web Store or a .crx
/// (internal), or from a folder (unpacked). Its own, default and policy
/// extensions aren't the user's.
const INTERNAL = 1;
const UNPACKED = 4;

/// The extensions' entries in a profile's record, by id, from both files.
const entriesOf = (defaultDir) => {
  const entries = {};
  for (const file of ["Preferences", "Secure Preferences"]) {
    const prefs = readJSON(path.join(defaultDir, file));
    const settings = prefs && prefs.extensions && prefs.extensions.settings;
    if (settings && typeof settings === "object") {
      for (const [id, entry] of Object.entries(settings)) {
        if (entry && typeof entry === "object") {
          entries[id] = Object.assign({}, entries[id], entry);
        }
      }
    }
  }
  return entries;
};

/// A manifest's text, its __MSG_name__ placeholders filled from its default
/// language's messages.
const localized = (dir, manifest, text) => {
  const match = typeof text === "string" && text.match(/^__MSG_(\w+)__$/);
  if (!match || !manifest.default_locale) {
    return typeof text === "string" ? text : "";
  }
  const messages = readJSON(path.join(dir, "_locales", String(manifest.default_locale), "messages.json")) || {};
  const key = Object.keys(messages).find((k) => k.toLowerCase() === match[1].toLowerCase());
  return key && messages[key] && typeof messages[key].message === "string" ? messages[key].message : text;
};

/// The user's extensions in the profile whose folder is `profileDir`: id,
/// name, version, whether it is on and whether it came from a folder.
const installedExtensions = (profileDir) => {
  const defaultDir = path.join(profileDir, "Default");
  const found = [];
  for (const [id, entry] of Object.entries(entriesOf(defaultDir))) {
    if (entry.location !== INTERNAL && entry.location !== UNPACKED) continue;
    if (entry.was_installed_by_default || entry.was_installed_by_oem || typeof entry.path !== "string") continue;
    const dir = entry.location === UNPACKED ? entry.path : path.join(defaultDir, "Extensions", entry.path);
    const manifest = readJSON(path.join(dir, "manifest.json")) || (entry.manifest && typeof entry.manifest === "object" ? entry.manifest : {});
    const reasons = Array.isArray(entry.disable_reasons) ? entry.disable_reasons : [];
    found.push({
      id,
      name: localized(dir, manifest, manifest.name) || id,
      version: typeof manifest.version === "string" ? manifest.version : "",
      enabled: reasons.length === 0 && entry.state !== 0,
      unpacked: entry.location === UNPACKED,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
};

const copyPath = (from, to) => {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    // What Chrome was in the middle of (an install, an update) isn't kept.
    filter: (source) => path.basename(source) !== "Temp" && !/^LOCK$/.test(path.basename(source)),
  });
};

/// Preferences as the copy starts with them: without the profile's own ids,
/// and closed as Chrome closes, so it offers nothing to restore.
const preferencesForCopy = (prefs) => {
  const copy = JSON.parse(JSON.stringify(prefs));
  for (const keys of OWN_IDS) {
    let parent = copy;
    for (const key of keys.slice(0, -1)) {
      parent = parent && typeof parent[key] === "object" ? parent[key] : null;
    }
    if (parent) delete parent[keys[keys.length - 1]];
  }
  copy.profile = Object.assign({}, copy.profile, { exit_type: "Normal", exited_cleanly: true });
  return copy;
};

/// Local State as the copy starts with it: the key Chrome encrypts the
/// profile's data and some of its signatures with (on Windows, kept by
/// Windows for this user), so the copied record checks out; nothing else of
/// the template's (its ids for Google's field trials and statistics).
const localStateForCopy = (localState) => (localState && localState.os_crypt ? { os_crypt: localState.os_crypt } : null);

/// Gives a new profile, whose folder is `profileDir` and which Chrome hasn't
/// opened yet, the template's extensions (the template's Chrome closed).
/// What it got: the extensions, none if the template has none or the
/// profile was opened before.
const copyInto = (templateDir, profileDir) => {
  const extensions = installedExtensions(templateDir);
  const to = path.join(profileDir, "Default");
  if (!extensions.length || fs.existsSync(path.join(to, "Preferences"))) {
    return [];
  }
  const from = path.join(templateDir, "Default");
  for (const part of EXTENSION_PARTS) {
    copyPath(path.join(from, part), path.join(to, part));
  }
  // The extensions' own IndexedDB, not the sites'.
  const indexedDB = path.join(from, "IndexedDB");
  if (fs.existsSync(indexedDB)) {
    for (const name of fs.readdirSync(indexedDB)) {
      if (name.startsWith("chrome-extension_")) {
        copyPath(path.join(indexedDB, name), path.join(to, "IndexedDB", name));
      }
    }
  }
  const prefs = readJSON(path.join(to, "Preferences"));
  if (prefs) {
    fs.writeFileSync(path.join(to, "Preferences"), JSON.stringify(preferencesForCopy(prefs)));
  }
  const localState = localStateForCopy(readJSON(path.join(templateDir, "Local State")));
  if (localState) {
    fs.writeFileSync(path.join(profileDir, "Local State"), JSON.stringify(localState));
  }
  return extensions;
};

module.exports = { TEMPLATE_ID, templateProfile, installedExtensions, copyInto, preferencesForCopy, localStateForCopy, EXTENSION_PARTS };
