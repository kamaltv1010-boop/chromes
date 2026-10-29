"use strict";
const fs = require("fs");
const path = require("path");

/// The trackers a page's requests never reach (Meta's, Google Analytics,
/// TikTok's…), as the Noor browser blocks them: a tracker's domain is
/// blocked on every site but its own and the ones it is allowed on
/// (facebook.net on instagram.com, say), so those sites still work.
const RULES = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "rules", "trackers.json"), "utf8"));
  } catch (error) {
    return [];
  }
})();

const within = (host, domain) => host === domain || host.endsWith("." + domain);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    return "";
  }
};

/// The address patterns Chrome is told to block for a page at `pageURL`.
const blockedFor = (pageURL, rules = RULES) => {
  const page = hostOf(pageURL);
  const patterns = [];
  for (const rule of rules) {
    if (!rule || typeof rule.domain !== "string") {
      continue;
    }
    const allowed = within(page, rule.domain) || (Array.isArray(rule.allowedOn) && rule.allowedOn.some((site) => within(page, site)));
    if (!allowed) {
      patterns.push(`*://${rule.domain}/*`, `*://*.${rule.domain}/*`);
    }
  }
  return patterns;
};

module.exports = { blockedFor, RULES };
