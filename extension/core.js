// Noor for Edge: what the extension keeps, and how pages are told it,
// apart from the browser's APIs, so the service worker (background.js),
// the popup, the build (tools/build-extension.js) and the tests run the
// same code.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NoorCore = factory();
  }
})(typeof self !== "undefined" ? self : this, () => {
  "use strict";

  /// The protections, by their name in protect.js's config.seeds.
  const KINDS = ["canvas", "webGL", "audio", "clientRects"];
  /// Audio and ClientRects start off, as in Noor for Windows: on a PC those
  /// values are nearly the same for everyone, so noise in them tells the
  /// browser apart instead of hiding it.
  const DEFAULT_ENABLED = { canvas: true, webGL: true, audio: false, clientRects: false };

  /// How many times a protection gets new values before they would come
  /// round again (then every protection gets a new master).
  const GENERATIONS = 64;
  const GEN_BITS = 6;
  /// The bits pages are told the state by (see filesFor): the master (0-31),
  /// each protection's generation (32-55) and whether it is on (56-59).
  const GEN_BASE = 32;
  const FLAG_BASE = GEN_BASE + GEN_BITS * KINDS.length;
  const BIT_COUNT = FLAG_BASE + KINDS.length;

  /// A new master: every protection's values on every site come from it.
  const newMaster = () => crypto.getRandomValues(new Uint32Array(1))[0];

  const isWord = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

  /// A site as the popup shows it and turns it off: a web page's host,
  /// without "www.", or null for anything else.
  const siteOf = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.hostname.replace(/^www\./, "") || null;
    } catch (error) {
      return null;
    }
  };

  const isSite = (site) => typeof site === "string" && siteOf(`https://${site}/`) === site;

  /// The state kept (chrome.storage.local), whole: anything missing or
  /// wrong in `stored` is made anew (a new master, the default switches).
  const normalize = (stored) => {
    const kept = stored && typeof stored === "object" ? stored : {};
    const master = isWord(kept.master) ? kept.master : newMaster();
    const gens = {};
    const enabled = {};
    for (const kind of KINDS) {
      const gen = kept.gens && kept.gens[kind];
      gens[kind] = Number.isInteger(gen) && gen >= 0 && gen < GENERATIONS ? gen : 0;
      const on = kept.enabled && kept.enabled[kind];
      enabled[kind] = typeof on === "boolean" ? on : DEFAULT_ENABLED[kind];
    }
    const offSites = Array.isArray(kept.offSites) ? [...new Set(kept.offSites.filter(isSite))].sort() : [];
    return { master, gens, enabled, offSites };
  };

  /// New values for `kinds` on every site: their next generation, or, all
  /// of them, a new master (as when one comes round again).
  const renew = (state, kinds) => {
    const next = { ...state, gens: { ...state.gens } };
    const all = KINDS.every((kind) => kinds.includes(kind));
    let master = all;
    for (const kind of kinds) {
      next.gens[kind] = (next.gens[kind] + 1) % GENERATIONS;
      master = master || next.gens[kind] === 0;
    }
    if (master) {
      let fresh = newMaster();
      while (fresh === state.master) fresh = newMaster();
      next.master = fresh;
      for (const kind of KINDS) next.gens[kind] = 0;
    }
    return next;
  };

  /// The bits of `state` that are set, by number (see BIT_COUNT).
  const bitsOf = (state) => {
    const set = [];
    for (let i = 0; i < 32; i++) {
      if ((state.master >>> i) & 1) set.push(i);
    }
    KINDS.forEach((kind, k) => {
      for (let i = 0; i < GEN_BITS; i++) {
        if ((state.gens[kind] >>> i) & 1) set.push(GEN_BASE + k * GEN_BITS + i);
      }
      if (state.enabled[kind]) set.push(FLAG_BASE + k);
    });
    return set;
  };

  /// What the browser runs in every frame before its own scripts. An
  /// extension's script there is one of its files, so the state is told by
  /// which files run: one for each bit set (bits/<n>.js, which only notes
  /// its number), then realm.js, which reads them and runs protect.js.
  const filesFor = (state) => [...bitsOf(state).map((n) => `bits/${n}.js`), "realm.js"];

  /// What protect.js is given, from the bits set (realm.js carries this
  /// function's source, so it uses nothing from outside itself): each
  /// protection's seed, or null for off, and the mark the copies of
  /// protect.js in a page find each other by (see `shared` there). Neither
  /// can be worked out without the master, which no page sees.
  function configFrom(bits) {
    const kinds = ["canvas", "webGL", "audio", "clientRects"];
    const has = (n) => bits.indexOf(n) !== -1;
    const word = (from, count) => {
      let value = 0;
      for (let i = 0; i < count; i++) {
        if (has(from + i)) value |= 1 << i;
      }
      return value >>> 0;
    };
    const mix = (n) => {
      n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
      n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
      return (n ^ (n >>> 16)) >>> 0;
    };
    const master = word(0, 32);
    const seeds = {};
    kinds.forEach((kind, k) => {
      const gen = word(32 + k * 6, 6);
      seeds[kind] = has(56 + k) ? mix(mix(master ^ Math.imul(k + 1, 0x9e3779b1)) ^ Math.imul(gen + 1, 0x85ebca77)) : null;
    });
    const key = "_" + [0x243f6a88, 0x85a308d3, 0x13198a2e].map((salt) => mix(master ^ salt).toString(16).padStart(8, "0")).join("");
    return { seeds, screen: null, hardware: null, key };
  }

  /// The pages of the sites turned off, as match patterns: "*.example.com"
  /// is example.com and every subdomain of it; an address is only itself.
  const excludeFor = (sites) => sites.map((site) => (/^[\d.]+$|:/.test(site) ? `*://${site}/*` : `*://*.${site}/*`));

  return {
    KINDS, DEFAULT_ENABLED, GENERATIONS, BIT_COUNT,
    newMaster, siteOf, isSite, normalize, renew, bitsOf, filesFor, configFrom, excludeFor,
  };
});
