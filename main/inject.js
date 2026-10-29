"use strict";
const crypto = require("crypto");
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
/// The name the scripts go by, where a stack could show it, and the mark of
/// the frame the protection is made in (see pageScript): new for each run
/// of the app, so a page can neither recognize nor imitate them.
const NAME = crypto.randomBytes(6).toString("hex") + ".js";
const KEY = "_" + crypto.randomBytes(12).toString("hex");

let protectSource = null;
const source = () => {
  if (protectSource === null) {
    protectSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "protect.js"), "utf8").replace("module.exports = protectPage;", "");
  }
  return protectSource;
};

/// Chrome runs this in every new document, before the page's own scripts.
/// The protection runs from a realm of its own: an empty frame's, made and
/// taken out of the document again at once. V8 leaves a function out of a
/// stack trace when its realm's security token isn't that of the code
/// reading the stack, and an empty frame that has loaded nothing keeps a
/// token of its own, so the protection's functions, made there, show no
/// frame in a stack a page reads, as the browser's own built-ins show none
/// (a page that runs its code inside them, through an argument's valueOf or
/// a script it adds, would otherwise find this script in the stack). The
/// frame is given a document of its own text (srcdoc), which Chrome puts
/// in later, from the browser, so until it is taken out it is the empty
/// document it starts as; nothing is asked of the network, and nothing
/// goes to another process. Chrome runs this script in that frame too, as
/// its window is made: there it does nothing (the frame's mark). The
/// protection is compiled there with the frame's eval, which a page's
/// policy (CSP) may forbid: the frame is first asked to compile "0", so a
/// page that forbids it hears of nothing of the protection. Then, or
/// failing anything else, the protection runs in the page's realm, as
/// before.
const pageScript = (config) => `(() => {
"use strict";
// Only sites are protected, not Chrome's own pages or extensions'.
if (!/^(https?|file|data|blob|about):$/.test(location.protocol)) return;
const KEY = ${JSON.stringify(KEY)};
try {
  const element = window.frameElement;
  if (element && Object.prototype.hasOwnProperty.call(element, KEY)) return;
} catch (e) {}
const SOURCE = ${JSON.stringify(`(() => {\n"use strict";\n${source()}\nreturn protectPage;\n})()\n//# sourceURL=${NAME}`)};
const SIGN_IN = ${JSON.stringify(SIGN_IN_SITES)};
const config = ${JSON.stringify(config)};
const host = (() => {
  try { if (window.top.location.hostname) return window.top.location.hostname; } catch (e) {}
  try { return window.location.hostname; } catch (e) { return ""; }
})();
const realDevice = SIGN_IN.some((site) => host === site || host.endsWith("." + site));
const given = { seeds: config.seeds, screen: realDevice ? null : config.screen, hardware: realDevice ? null : config.hardware };

const hiddenProtect = () => {
  let frame = null;
  let parent = null;
  try {
    const document = window.document;
    frame = document.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
    frame[KEY] = true;
    frame.srcdoc = "";
    parent = document.documentElement || document;
    parent.appendChild(frame);
    const realm = frame.contentWindow;
    if (!realm || realm.location.href !== "about:blank") return null;
    const evaluate = realm.eval;
    evaluate("0");
    const made = evaluate(SOURCE);
    return typeof made === "function" ? made : null;
  } catch (e) {
    return null;
  } finally {
    try { if (frame && parent && frame.parentNode === parent) parent.removeChild(frame); } catch (e) {}
  }
};

// What the protection hands the browser to call later is handed over from
// this realm, the page's, which the browser still calls back (see
// \`outside\` in protect.js): taken before the page's scripts can change them.
const reflectApply = Reflect.apply;
const reflectConstruct = Reflect.construct;
const callMethod = Function.prototype.call;
const bindMethod = Function.prototype.bind;
const outside = {
  apply: (fn, self, args) => reflectApply(fn, self, args),
  construct: (Type, args) => reflectConstruct(Type, args),
  // A function of this realm that calls \`fn\` on \`self\` with no frame of its own.
  callback: (fn, self) => reflectApply(bindMethod, callMethod, [fn, self]),
};

const hidden = hiddenProtect();
if (hidden) {
  try {
    hidden(window, Object.assign({}, given, { framesHidden: true, outside }));
    return;
  } catch (e) {}
}
// Here, Chrome lets this script compile code whatever the page's policy.
try {
  (0, eval)(SOURCE)(window, given);
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

/// The script for a worker whose script is at `url`. `hidden` when it will
/// run as the debugger's own code, whose frames no stack shows (see
/// ChromeInstance.setUpWorker).
const workerScript = (config, url, hidden = false) => {
  const host = hostOfWorker(url);
  const realDevice = SIGN_IN_SITES.some((site) => host === site || host.endsWith("." + site));
  const given = { seeds: config.seeds, screen: realDevice ? null : config.screen, hardware: realDevice ? null : config.hardware, host };
  if (hidden) {
    given.framesHidden = true;
  }
  return `(() => {
"use strict";
${source()}
try { protectPage(self, ${JSON.stringify(given)}); } catch (e) {}
})();
//# sourceURL=${NAME}`;
};

module.exports = { pageScript, workerScript, hostOfWorker, SIGN_IN_SITES, NAME, KEY };
