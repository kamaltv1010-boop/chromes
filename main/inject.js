"use strict";
const fs = require("fs");
const path = require("path");

/// The protection, as scripts for Chrome's pages and workers: the same
/// protectPage as the Noor browser's (scripts/protect.js), with a profile's
/// config. A page decides for itself whether it is on a sign-in site, which
/// checks the screen and hardware against the device and sees the real
/// ones. A worker is told its page's host, which keys the noise, since it
/// has no location before it starts.
const SIGN_IN_SITES = [
  "instagram.com", "facebook.com", "messenger.com", "threads.net", "threads.com", "whatsapp.com",
  "meta.com", "fb.com", "accounts.google.com", "appleid.apple.com", "idmsa.apple.com",
  "login.live.com", "login.microsoftonline.com",
];
const NAME = "noor.js";

let protectSource = null;
const source = () => {
  if (protectSource === null) {
    protectSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "protect.js"), "utf8").replace("module.exports = protectPage;", "");
  }
  return protectSource;
};

const pageScript = (config) => `(() => {
${source()}
const SIGN_IN = ${JSON.stringify(SIGN_IN_SITES)};
const config = ${JSON.stringify(config)};
const host = (() => {
  try { if (window.top.location.hostname) return window.top.location.hostname; } catch (e) {}
  try { return window.location.hostname; } catch (e) { return ""; }
})();
const realDevice = SIGN_IN.some((site) => host === site || host.endsWith("." + site));
try {
  protectPage(window, { seeds: config.seeds, screen: realDevice ? null : config.screen, hardware: realDevice ? null : config.hardware });
} catch (e) {}
})();
//# sourceURL=${NAME}`;

/// The host of a worker's page from its script's address: a blob: address
/// carries the page's origin in its path.
const hostOfWorker = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "blob:") {
      return new URL(parsed.pathname).hostname;
    }
    return parsed.hostname;
  } catch (error) {
    return "";
  }
};

const workerScript = (config, url) => {
  const host = hostOfWorker(url);
  const realDevice = SIGN_IN_SITES.some((site) => host === site || host.endsWith("." + site));
  const given = { seeds: config.seeds, screen: realDevice ? null : config.screen, hardware: realDevice ? null : config.hardware, host };
  return `(() => {
${source()}
try { protectPage(self, ${JSON.stringify(given)}); } catch (e) {}
})();
//# sourceURL=${NAME}`;
};

module.exports = { pageScript, workerScript, hostOfWorker, SIGN_IN_SITES };
