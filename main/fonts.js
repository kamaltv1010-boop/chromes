"use strict";

const fs = require("fs");
const WINDOWS = require("../rules/windows-fonts.json");
const POOL = require("../rules/font-pool.json");

/// Font fingerprint protection. A site measures which fonts a computer has
/// (text asked in a font that is there measures unlike the fallback's) and
/// the list tells computers apart, and so every profile on one from the
/// others. In Noor each profile shows the fonts every Windows comes with
/// (rules/windows-fonts.json) and others of its own, picked from its seed
/// among those PCs have for their programs and languages
/// (rules/font-pool.json: Office's on about half, Adobe Acrobat's,
/// Windows' Arabic ones…; see pickFonts). The other fonts of this computer
/// are hidden from pages, and a font picked that this computer lacks is
/// drawn with one of Windows' own of its kind, at a size of its own (see
/// scripts/parts/fonts.js). No font file comes with the app: Windows' own
/// are on every Windows already.

const lower = (name) => String(name).toLowerCase().replace(/\s+/g, " ").trim();
const FAMILIES = new Set(WINDOWS.families.map(lower));
const PREFIXES = WINDOWS.prefixes.map(lower);
const STYLES = new Set(WINDOWS.styles.map(lower));

/// Whether `name` is one of `families`, alone or followed by style words
/// only ("Segoe UI Semibold", "Gill Sans MT Bold"): the longest family the
/// name starts with, so "Arial Nova Light" is Arial Nova's and "Arial
/// Narrow" isn't Arial's ("narrow" is no style word).
const isOf = (families, name) => {
  const words = lower(name).split(" ");
  for (let count = words.length; count > 0; count--) {
    if (families.has(words.slice(0, count).join(" "))) {
      return words.slice(count).every((word) => STYLES.has(word));
    }
  }
  return false;
};

/// Whether `name` (a family, or a face's full name) is one of the fonts
/// every Windows comes with: one of its families (see isOf), or a name
/// that starts with a family only Microsoft makes ("Segoe UI Variable
/// Display Semib", as Windows cuts its older names to 31 letters).
const isWindowsFont = (name) => {
  const text = lower(name);
  if (!text) {
    return false;
  }
  if (PREFIXES.some((prefix) => text === prefix || text.startsWith(prefix + " "))) {
    return true;
  }
  return isOf(FAMILIES, text);
};

/// The ends Chromium takes off a family it doesn't find, to find the rest
/// at that weight or width ("Gill Sans MT Light": Gill Sans MT at 300).
const SUFFIXES = new Set(["thin", "extralight", "ultralight", "light", "regular", "medium", "demibold", "semibold",
  "extrabold", "ultrabold", "black", "heavy", "ultracondensed", "extracondensed", "condensed", "semicondensed",
  "semiexpanded", "expanded", "extraexpanded", "ultraexpanded"]);

/// What pages are kept from finding, from this computer's font faces
/// (`faces`: [family, full name, PostScript name, style] each, as the
/// browser's queryLocalFonts gives them), all but those `kept` (Windows'
/// own, and a profile's picks): `families`, the fonts hidden; `shadow`,
/// the names a page can ask for one of them by in CSS (its family, and its
/// faces' full names but the bold and italic ones, which no family is
/// asked by); `local`, every name FontFace's local() looks a face up by
/// (family, full and PostScript names), in lower case. Each sorted,
/// without repeats.
const hiddenFonts = (faces, kept = isWindowsFont) => {
  const families = new Map();
  const shadow = new Map();
  const local = new Set();
  for (const face of Array.isArray(faces) ? faces : []) {
    if (!Array.isArray(face)) {
      continue;
    }
    const [family, fullName, postscriptName] = face.map((value) => (typeof value === "string" ? value.trim() : ""));
    const familyHidden = Boolean(family) && !kept(family);
    // A face of a family kept that isn't (Office's Arial Narrow, among
    // Arial's faces): its own names alone.
    const faceHidden = familyHidden || (Boolean(fullName) && !kept(fullName));
    if (!faceHidden) {
      continue;
    }
    if (familyHidden) {
      families.set(lower(family), family);
      shadow.set(lower(family), family);
      local.add(lower(family));
    }
    if (fullName) {
      local.add(lower(fullName));
      const words = lower(fullName).split(" ");
      const plain = !words.some((word) => word === "italic" || word === "oblique") && !/ (bold|regular)$/.test(lower(fullName));
      const rest = familyHidden && lower(fullName).startsWith(lower(family) + " ") ? lower(fullName).slice(lower(family).length + 1).split(" ") : null;
      if (plain && (!rest || rest.every((word) => SUFFIXES.has(word)))) {
        shadow.set(lower(fullName), fullName);
      }
    }
    if (postscriptName) {
      local.add(lower(postscriptName));
    }
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((entry) => entry[1]);
  return { families: sorted(families), shadow: sorted(shadow), local: [...local].sort() };
};

/// The pool's fonts, each with its kind ("serif"…), from a list by kind.
const byName = (byKind) => Object.entries(byKind || {}).flatMap(([kind, names]) => names.map((name) => ({ name, kind })));
const GROUPS = POOL.groups.map((group) => ({ name: group.name, share: group.share, fonts: byName(group.fonts) }));
const SINGLES = byName(POOL.singles.fonts);

/// Numbers from a seed, the same each time for the same seed (mulberry32).
const numbers = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/// The fonts a profile has beyond Windows' own, from its seed: the
/// `groups` it has (each as often as its share says) and up to a few
/// `singles`, and every font of them (`fonts`: { name, kind } each, once).
const pickFonts = (seed) => {
  const next = numbers(seed);
  const groups = GROUPS.filter((group) => next() < group.share);
  const count = Math.floor(next() * (POOL.singles.most + 1));
  const left = SINGLES.slice();
  const singles = [];
  while (singles.length < count && left.length) {
    singles.push(left.splice(Math.floor(next() * left.length), 1)[0]);
  }
  const fonts = new Map();
  for (const font of groups.flatMap((group) => group.fonts).concat(singles)) {
    if (!fonts.has(lower(font.name))) {
      fonts.set(lower(font.name), font);
    }
  }
  return { groups: groups.map((group) => group.name), singles: singles.map((font) => font.name), fonts: [...fonts.values()] };
};

/// A number from a font's name (FNV-1a): a font is drawn the same way in
/// every profile, as a font is the same font on every PC.
const hashOf = (text) => {
  let hash = 2166136261;
  for (const character of lower(text)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

/// How a font this computer lacks is drawn: with one of Windows' own of
/// its kind (`standIn`), at a size of its own (`sizeAdjust`, in percent:
/// 88 to 112, never 99 to 101, so it measures unlike the font it is drawn
/// with).
const drawnAs = (font) => {
  const standIns = POOL.standIns[font.kind] || POOL.standIns.sans;
  const hash = hashOf(font.name);
  let sizeAdjust = 88 + (hash % 25);
  if (sizeAdjust >= 99 && sizeAdjust <= 101) {
    sizeAdjust += 3;
  }
  return { name: font.name, kind: font.kind, standIn: standIns[(hash >>> 8) % standIns.length], sizeAdjust };
};

/// What a profile with `seed` shows of fonts, from this computer's
/// (`faces`, see hiddenFonts): Windows' own and the profile's picks are
/// kept, the rest hidden (`families`, `shadow`, `local`); `added`, its
/// picks this computer lacks, each as drawnAs draws it; `picked`, its
/// groups and singles, for the settings to show.
const fontsFor = (seed, faces) => {
  const picked = pickFonts(seed);
  const pickedNames = new Set(picked.fonts.map((font) => lower(font.name)));
  const kept = (name) => isWindowsFont(name) || isOf(pickedNames, name);
  const hidden = hiddenFonts(faces, kept);
  const installed = new Set();
  for (const face of Array.isArray(faces) ? faces : []) {
    if (Array.isArray(face)) {
      for (const name of face.slice(0, 2)) {
        if (typeof name === "string") {
          installed.add(lower(name));
        }
      }
    }
  }
  const added = picked.fonts.filter((font) => !installed.has(lower(font.name))).map(drawnAs);
  return Object.assign(hidden, { added, picked: { groups: picked.groups, singles: picked.singles } });
};

/// What a page of the app's own asks the browser for this computer's
/// fonts with, once it is shown (the browser answers a visible page only).
const QUERY = `(async () => {
  if (document.visibilityState !== "visible") {
    await new Promise((resolve) => document.addEventListener("visibilitychange", resolve, { once: true }));
  }
  const fonts = await queryLocalFonts();
  return fonts.map((font) => [font.family, font.fullName, font.postscriptName, font.style]);
})()`;

/// This computer's fonts, as the browser lists them: kept in the app's
/// data (`file`) for the next run, asked again each run from one of the
/// app's own pages (see refresh). `faces` given (tests) stands for them.
class FontList {
  constructor(file, { faces = null } = {}) {
    this.file = file;
    this.faces = null;
    /// What each profile's seed shows (see fontsFor), worked out once.
    this.memo = new Map();
    /// The asking under way, whether one has answered this run, and how
    /// many times it was tried (a window that didn't show in time).
    this.asking = null;
    this.answered = false;
    this.tries = 0;
    if (Array.isArray(faces)) {
      this.faces = faces;
      this.answered = true;
    } else {
      this.read();
    }
  }

  read() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (saved && Array.isArray(saved.faces)) {
        this.faces = saved.faces;
      }
    } catch (error) {
      // None kept yet.
    }
  }

  get known() {
    return Array.isArray(this.faces);
  }

  /// Asks the page of `webContents` (one of the app's own, which the
  /// browser lets list the fonts) for them, until one answers this run (a
  /// few tries at most: another window shown tries again); settles when
  /// they are known, or the asking failed, or after `waitMs`.
  refresh(webContents, waitMs = 3000) {
    if (this.answered || this.tries >= 3) {
      return Promise.resolve();
    }
    if (!this.asking) {
      this.tries++;
      const answer = Promise.resolve().then(() => webContents.executeJavaScript(QUERY)).then((faces) => {
        if (!Array.isArray(faces)) {
          return;
        }
        this.faces = faces.filter((face) => Array.isArray(face) && typeof face[0] === "string");
        this.memo.clear();
        this.answered = true;
        try {
          fs.writeFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), faces: this.faces }));
        } catch (error) {
          // Asked again next run.
        }
      }, () => {});
      this.asking = Promise.race([answer, new Promise((resolve) => setTimeout(resolve, waitMs))]).then(() => {
        this.asking = null;
      });
    }
    return this.asking;
  }

  /// Settles once the fonts are known to pages: at once if a list was kept
  /// from an earlier run (a new one is asked for meanwhile), else when the
  /// asking settles.
  whenKnown(webContents) {
    const known = this.known;
    const asking = webContents ? this.refresh(webContents) : this.asking;
    return known ? Promise.resolve() : Promise.resolve(asking);
  }

  /// What a profile with `seed` shows (see fontsFor), or null while this
  /// computer's fonts aren't known.
  forSeed(seed) {
    if (!this.known) {
      return null;
    }
    const key = seed >>> 0;
    if (!this.memo.has(key)) {
      this.memo.set(key, fontsFor(key, this.faces));
    }
    return this.memo.get(key);
  }

  /// For Noor iPhone and Noor Android: this computer's fonts a device
  /// doesn't show, all but those `kept` (see hiddenFonts), worked out once
  /// for each `key` (the device's font list), or null while they aren't
  /// known.
  hiddenFor(key, kept) {
    if (!this.known) {
      return null;
    }
    const name = "device " + key;
    if (!this.memo.has(name)) {
      this.memo.set(name, hiddenFonts(this.faces, kept));
    }
    return this.memo.get(name);
  }
}

/// Whether `name` (a family, or a face's full name) is one of `families`,
/// alone or with style words (see isOf): what a device keeps.
const keptBy = (families) => {
  const set = new Set(families.map(lower));
  return (name) => isOf(set, name);
};

module.exports = { isWindowsFont, hiddenFonts, keptBy, pickFonts, drawnAs, fontsFor, FontList, QUERY, SUFFIXES };
