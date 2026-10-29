"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/// The profiles: each opens Chrome with a folder of its own, where Chrome
/// keeps everything of that profile (cookies, logins, extensions, history,
/// settings), and with fingerprints of its own. A profile may have a
/// proxy, which Chrome is told of when it opens.
class Profiles {
  constructor(store, root) {
    this.store = store;
    this.root = root;
  }

  /// Every profile, oldest first.
  all() {
    let saved = this.store.get("profiles", []);
    if (!Array.isArray(saved)) {
      saved = [];
    }
    return saved
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({ id: p.id, name: p.name, proxy: typeof p.proxy === "string" ? p.proxy : "", created: Number(p.created) || 0 }))
      .sort((a, b) => a.created - b.created);
  }

  find(id) {
    return this.all().find((p) => p.id === id) || null;
  }

  add(name) {
    const profile = { id: crypto.randomUUID(), name: String(name || "").trim() || `Profile ${this.all().length + 1}`, proxy: "", created: Date.now() };
    this.save(this.all().concat([profile]));
    return profile;
  }

  rename(id, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return;
    }
    this.save(this.all().map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }

  setProxy(id, proxy) {
    this.save(this.all().map((p) => (p.id === id ? { ...p, proxy: String(proxy || "").trim() } : p)));
  }

  /// Removes a profile with its folder and everything kept for it.
  remove(id) {
    const profile = this.find(id);
    if (!profile) {
      return;
    }
    this.save(this.all().filter((p) => p.id !== id));
    for (const key of this.store.keys()) {
      if (key.startsWith(`profile.${id}.`)) {
        this.store.delete(key);
      }
    }
    try {
      fs.rmSync(this.dir(profile), { recursive: true, force: true });
    } catch (error) {
      // The folder may be in use; it is left behind.
    }
  }

  save(list) {
    this.store.set("profiles", list.map((p) => ({ id: p.id, name: p.name, proxy: p.proxy || "", created: p.created })));
  }

  /// The folder Chrome keeps a profile in.
  dir(profile) {
    return path.join(this.root, "profiles", profile.id);
  }

  /// The store key of a value kept per profile.
  key(base, profile) {
    return `profile.${profile.id}.${base}`;
  }
}

module.exports = { Profiles };
