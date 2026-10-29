"use strict";
const fs = require("fs");
const path = require("path");

/// Settings and other small state, as one JSON file in the app's data
/// folder, like the iOS app's UserDefaults. Reads come from memory; every
/// write saves the file.
class Store {
  constructor(file) {
    this.file = file;
    this.data = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.data = parsed;
      }
    } catch (error) {
      this.data = {};
    }
  }

  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : fallback;
  }

  set(key, value) {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.save();
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  keys() {
    return Object.keys(this.data);
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (error) {
      // Nothing to do: the settings stay in memory for this run.
    }
  }
}

module.exports = { Store };
