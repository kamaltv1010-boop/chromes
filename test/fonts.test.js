"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isWindowsFont, hiddenFonts, pickFonts, drawnAs, fontsFor, FontList } = require("../main/fonts");
const POOL = require("../rules/font-pool.json");

test("the fonts every Windows has, their weights and widths", () => {
  for (const name of ["Arial", "arial", "Arial Black", "Segoe UI", "Segoe UI Semibold", "Segoe UI Light", "Calibri Light",
    "Bahnschrift Light Condensed", "Cambria Math", "Franklin Gothic Medium", "Segoe UI Variable Display Semib",
    "Sitka Small Semibold", "Yu Gothic UI Semilight", "Microsoft YaHei UI Light", "Times New Roman Bold Italic", "Cascadia Code"]) {
    assert.ok(isWindowsFont(name), name);
  }
  // Those Windows adds with a language are a profile's to pick.
  for (const name of ["Arabic Typesetting", "Sakkal Majalla", "Arial Nova Light", "MS Mincho"]) {
    assert.ok(!isWindowsFont(name), name);
  }
});

test("other programs' fonts aren't Windows'", () => {
  for (const name of ["Arial Narrow", "Arial Rounded MT Bold", "Arial Unicode MS", "Franklin Gothic Book",
    "Franklin Gothic Medium Cond", "Gill Sans MT", "Century Gothic", "Garamond", "Book Antiqua", "Lucida Sans",
    "Lucida Sans Typewriter", "MS Outlook", "MS Reference Sans Serif", "ZWAdobeF", "Myriad Pro", "Wingdings 2",
    "Inter", "JetBrains Mono", "DejaVu Sans", "Liberation Sans", "Roboto", "", "  "]) {
    assert.ok(!isWindowsFont(name), name);
  }
});

test("what pages are kept from finding: families, CSS names and local() names", () => {
  const faces = [
    ["Arial", "Arial", "ArialMT", "Regular"],
    ["Arial", "Arial Narrow", "ArialNarrow", "Regular"],
    ["Segoe UI", "Segoe UI Semibold", "SegoeUI-Semibold", "Semibold"],
    ["Gill Sans MT", "Gill Sans MT", "GillSansMT", "Regular"],
    ["Gill Sans MT", "Gill Sans MT Bold", "GillSansMT-Bold", "Bold"],
    ["Gill Sans MT", "Gill Sans MT Italic", "GillSansMT-Italic", "Italic"],
    ["Gill Sans MT", "Gill Sans MT Condensed", "GillSansMT-Condensed", "Condensed"],
    ["Copperplate Gothic", "Copperplate Gothic Light", "CopperplateGothic-Light", "Light"],
    ["MS Outlook", "MS Outlook", "MSOutlook", "Regular"],
  ];
  const hidden = hiddenFonts(faces);
  assert.deepStrictEqual(hidden.families, ["Copperplate Gothic", "Gill Sans MT", "MS Outlook"]);
  // Asked for in CSS: the families, a face's weight or width named after
  // its family, and Office's Arial Narrow; not Arial, nor Segoe UI.
  assert.deepStrictEqual(hidden.shadow, ["Arial Narrow", "Copperplate Gothic", "Copperplate Gothic Light", "Gill Sans MT", "Gill Sans MT Condensed", "MS Outlook"]);
  for (const name of ["gill sans mt bold", "gillsansmt-italic", "arialnarrow", "arial narrow", "msoutlook", "copperplategothic-light"]) {
    assert.ok(hidden.local.includes(name), name);
  }
  for (const name of ["arial", "arialmt", "segoe ui semibold", "segoeui-semibold"]) {
    assert.ok(!hidden.local.includes(name), name);
  }
});

test("a stock Windows hides nothing", () => {
  const hidden = hiddenFonts([["Arial", "Arial", "ArialMT", "Regular"], ["Segoe UI", "Segoe UI Light", "SegoeUI-Light", "Light"], ["Bahnschrift", "Bahnschrift SemiBold Condensed", "Bahnschrift-SemiBoldCondensed", "SemiBold Condensed"]]);
  assert.deepStrictEqual(hidden, { families: [], shadow: [], local: [] });
  assert.deepStrictEqual(hiddenFonts(null), { families: [], shadow: [], local: [] });
});

test("the font list is kept for the next run, and asked for once a run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noor-fonts-"));
  const file = path.join(dir, "fonts.json");
  const first = new FontList(file);
  assert.strictEqual(first.known, false);
  assert.strictEqual(first.forSeed(1), null);
  let asked = 0;
  const page = { executeJavaScript: async () => { asked++; return [["Inter", "Inter", "Inter-Regular", "Regular"], ["Arial", "Arial", "ArialMT", "Regular"]]; } };
  await first.whenKnown(page);
  await first.refresh(page);
  assert.strictEqual(asked, 1);
  // Inter, which no profile picks, is hidden in every one.
  const seed = 1;
  assert.deepStrictEqual(first.forSeed(seed).families, ["Inter"]);
  // The next run knows them at once, and asks again meanwhile.
  const next = new FontList(file);
  assert.strictEqual(next.known, true);
  assert.deepStrictEqual(next.forSeed(seed).families, ["Inter"]);
  let settled = false;
  const slow = { executeJavaScript: () => new Promise(() => {}) };
  next.whenKnown(slow).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(settled, true);
});

test("a page that can't answer doesn't hold up the first run for long", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noor-fonts-"));
  const list = new FontList(path.join(dir, "fonts.json"));
  const started = Date.now();
  await list.refresh({ executeJavaScript: () => new Promise(() => {}) }, 50);
  assert.ok(Date.now() - started < 1000);
  assert.strictEqual(list.known, false);
  const failing = new FontList(path.join(dir, "other.json"));
  await failing.refresh({ executeJavaScript: async () => { throw new Error("Page needs to be visible."); } });
  assert.strictEqual(failing.known, false);
  // Another window shown asks again, a few times at most.
  await failing.refresh({ executeJavaScript: async () => [["Inter", "Inter", "Inter-Regular", "Regular"]] });
  assert.deepStrictEqual(failing.forSeed(1).families, ["Inter"]);
  let more = 0;
  await failing.refresh({ executeJavaScript: async () => { more++; return []; } });
  assert.strictEqual(more, 0);
  const never = new FontList(path.join(dir, "never.json"));
  let tries = 0;
  for (let i = 0; i < 5; i++) await never.refresh({ executeJavaScript: async () => { tries++; throw new Error("no"); } });
  assert.strictEqual(tries, 3);
});

test("each profile picks fonts of its own, the same each time for its seed", () => {
  assert.deepStrictEqual(pickFonts(42), pickFonts(42));
  const sets = new Set();
  let office = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const picked = pickFonts(seed * 7919);
    sets.add(picked.groups.concat(picked.singles).join(","));
    if (picked.groups.includes("Office")) office++;
    assert.ok(picked.singles.length <= POOL.singles.most);
    assert.strictEqual(new Set(picked.fonts.map((font) => font.name.toLowerCase())).size, picked.fonts.length);
  }
  // Hardly two alike, and Office on about half.
  assert.ok(sets.size > 300, String(sets.size));
  assert.ok(office > 140 && office < 260, String(office));
});

test("a font this computer lacks is drawn with one of Windows' own, at a size of its own, the same in every profile", () => {
  for (const font of [{ name: "Garamond", kind: "serif" }, { name: "Roboto", kind: "sans" }, { name: "Fira Code", kind: "mono" }, { name: "ZWAdobeF", kind: "symbol" }, { name: "Meiryo", kind: "cjk" }]) {
    const drawn = drawnAs(font);
    assert.deepStrictEqual(drawn, drawnAs({ ...font }));
    assert.ok(isWindowsFont(drawn.standIn), drawn.standIn);
    assert.ok(POOL.standIns[font.kind].includes(drawn.standIn));
    assert.ok(drawn.sizeAdjust >= 88 && drawn.sizeAdjust <= 112 && (drawn.sizeAdjust < 99 || drawn.sizeAdjust > 101), String(drawn.sizeAdjust));
  }
  // Every stand-in is a font every Windows has.
  for (const names of Object.values(POOL.standIns)) for (const name of names) assert.ok(isWindowsFont(name), name);
});

test("a profile's fonts: Windows' own and its picks kept, its picks this computer lacks drawn, the rest hidden", () => {
  // A seed that picks Office, and one that doesn't.
  let withOffice = null;
  let without = null;
  for (let seed = 1; (withOffice === null || without === null) && seed < 1000; seed++) {
    const groups = pickFonts(seed).groups;
    if (groups.includes("Office") && withOffice === null) withOffice = seed;
    if (!groups.includes("Office") && without === null) without = seed;
  }
  const faces = [
    ["Arial", "Arial", "ArialMT", "Regular"],
    ["Gill Sans MT", "Gill Sans MT", "GillSansMT", "Regular"],
    ["Gill Sans MT", "Gill Sans MT Bold", "GillSansMT-Bold", "Bold"],
    ["Inter", "Inter", "Inter-Regular", "Regular"],
  ];
  const office = fontsFor(withOffice, faces);
  // Gill Sans MT is this computer's: shown as it is, not drawn.
  assert.ok(!office.families.includes("Gill Sans MT"));
  assert.ok(!office.added.some((font) => font.name === "Gill Sans MT"));
  assert.ok(office.added.some((font) => font.name === "Garamond"));
  assert.ok(office.families.includes("Inter"));
  assert.ok(!office.local.includes("arialmt"));
  const plain = fontsFor(without, faces);
  assert.ok(plain.families.includes("Gill Sans MT"));
  assert.ok(plain.local.includes("gillsansmt-bold"));
  assert.ok(!plain.added.some((font) => font.name === "Garamond"));
  assert.deepStrictEqual(plain.picked.groups, pickFonts(without).groups);
});
