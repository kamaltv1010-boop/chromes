"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../main/store");

/// A store in a fresh temporary folder.
const tempStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noor-test-")), "settings.json"));

module.exports = { tempStore };
