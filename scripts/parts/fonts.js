// Fonts: each profile's own (config.fonts, see main/fonts.js). A site
// measures which fonts a computer has, and the list tells computers, and
// the profiles on one, apart: a profile shows the fonts every Windows has
// and others of its own, and no other font of this computer.
// - A font of this computer's the profile doesn't have (`shadow`) gets, in
//   each page, a face of its own that covers no character: text asked in
//   it falls through to the next font, as where it isn't installed. Never
//   loaded, these faces start no download and fire no event.
// - A font the profile has that this computer lacks (`added`) gets a face
//   named for it, drawn with a font of Windows' own of its kind at a size
//   of its own, loaded before the page's first script; the loading shows
//   in neither the font list's status, nor its ready, nor its events.
// The page's own font list (document.fonts) shows none of these faces. A
// font asked for by name (FontFace's local()) is looked for the same way,
// and so is one given to a worker's canvas (a worker's font list isn't
// there before its first line). The same as Noor's (the Noor browser's
// scripts/parts/fonts.js); in Chrome, a site the user lets list this PC's
// fonts (queryLocalFonts, which Chrome asks about) gets the list without
// the hidden ones.
{
  const fonts = config.fonts;
  const isWindow = Boolean(document) && typeof window.Window === "function";
  const PageTypeError = window.TypeError;
  const lower = (name) => String(name).toLowerCase().replace(/\s+/g, " ").trim();
  const shadow = Array.isArray(fonts.shadow) ? fonts.shadow : [];
  const hidden = new Set(shadow.map(lower));
  const local = new Set((Array.isArray(fonts.local) ? fonts.local : []).map(lower));
  const added = new Map((Array.isArray(fonts.added) ? fonts.added : []).filter((font) => font && font.name && font.standIn).map((font) => [lower(font.name), font]));
  const missing = "Noor No Such Font " + String(config.mark || "").slice(0, 6);
  const quoted = (name) => '"' + String(name).replace(/["\\]/g, "\\$&") + '"';
  // Behind a font drawn with one of Windows' own, fonts of other systems
  // like it, for a computer that isn't Windows (tests).
  const ELSEWHERE = { serif: ["Liberation Serif", "DejaVu Serif"], mono: ["Liberation Mono", "DejaVu Sans Mono"] };
  const localsFor = (font) => [font.standIn].concat(ELSEWHERE[font.kind] || ["Liberation Sans", "DejaVu Sans"]).map((name) => `local(${quoted(name)})`).join(", ");
  // The font a name is one of the added ones' (a face's full name, "Garamond
  // Bold", is its family's), or undefined.
  const addedFor = (name) => {
    const text = lower(name);
    if (added.has(text)) return added.get(text);
    for (const [family, font] of added) if (text.indexOf(family + " ") === 0) return font;
    return undefined;
  };
  const RealFontFace = window.FontFace;
  const FontSet = window.FontFaceSet;
  const fontFaceSetLoadEvent = window.FontFaceSetLoadEvent;
  // A promise of the page's, settled, made as the browser makes its own
  // (with the functions as they were before the page's first script).
  const PagePromise = window.Promise;
  const promiseResolve = PagePromise && PagePromise.resolve;
  const resolved = (value) => Reflect.apply(promiseResolve, PagePromise, [value]);
  // The faces made here, in this page's and in its empty frames'.
  const ours = new WeakSet();

  if (typeof RealFontFace === "function") {
    // local(): a hidden font's names find nothing, an added font's find
    // the font it is drawn with.
    const rewrite = (source) => source.replace(/local\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi, (whole, a, b, c) => {
      const name = (a !== undefined ? a : b !== undefined ? b : c).trim();
      const font = addedFor(name);
      if (font) return localsFor(font);
      return local.has(lower(name)) ? `local(${quoted(missing)})` : whole;
    });
    const FontFace = {
      FontFace: function (family, source) {
        "use strict"; /* noor lookalike */
        if (new.target === undefined) throw new PageTypeError("Failed to construct 'FontFace': Please use the 'new' operator, this DOM object constructor cannot be called as a function.");
        const args = Array.prototype.slice.call(arguments);
        if (args.length >= 2 && !(args[1] && typeof args[1] === "object")) args[1] = rewrite(`${args[1]}`);
        return Reflect.construct(RealFontFace, args, new.target === FontFace ? RealFontFace : new.target);
      },
    }.FontFace;
    setPrototypeOf(FontFace, getPrototypeOf(RealFontFace));
    defineProperty(FontFace, "length", { value: RealFontFace.length });
    defineProperty(FontFace, "prototype", { value: RealFontFace.prototype, writable: false, enumerable: false, configurable: false });
    originals.set(FontFace, RealFontFace);
    try { defineProperty(RealFontFace.prototype, "constructor", { value: FontFace, writable: true, enumerable: false, configurable: true }); } catch (e) {}
    defineProperty(window, "FontFace", { value: FontFace, writable: true, enumerable: false, configurable: true });
  }

  if (isWindow && typeof RealFontFace === "function" && FontSet && (shadow.length || added.size)) {
    const proto = FontSet.prototype;
    const realAdd = proto.add;
    const realDelete = proto.delete;
    const valuesOf = proto.values;
    const faceStatusOf = (getOwnPropertyDescriptor(RealFontFace.prototype, "status") || {}).get;
    const setStatusOf = (getOwnPropertyDescriptor(proto, "status") || {}).get;
    // A document's own font list, read with the browser's getter.
    const fontsOf = window.Document && (getOwnPropertyDescriptor(window.Document.prototype, "fonts") || {}).get;
    const theirs = (set) => {
      const list = [];
      const iterator = valuesOf.call(set);
      for (let step = iterator.next(); !step.done; step = iterator.next()) if (!ours.has(step.value)) list.push(step.value);
      return list;
    };
    // Whether a face of the page's own is loading in `set`.
    const pageLoading = (set) => {
      try {
        return Boolean(faceStatusOf) && theirs(set).some((face) => faceStatusOf.call(face) === "loading");
      } catch (e) {
        return true;
      }
    };

    // The loading of ours, unseen: its events stop before the page's
    // listeners (this one is the first), and the list reads as loaded and
    // ready while only ours load (`ready` then the same promise each time,
    // already settled, as where nothing loads).
    const stopImmediate = window.Event && window.Event.prototype.stopImmediatePropagation;
    const facesOf = fontFaceSetLoadEvent && (getOwnPropertyDescriptor(fontFaceSetLoadEvent.prototype, "fontfaces") || {}).get;
    const addListener = window.EventTarget && window.EventTarget.prototype.addEventListener;
    // In each document's font list (the page's, and the one of each page a
    // window kept from its empty start loads later: see eachDocument; in
    // the first's alone, a frame of the site's own would show this
    // computer's fonts).
    eachDocument((each) => {
      const fontSet = fontsOf ? fontsOf.call(each) : each.fonts;
      if (!fontSet) return;
      if (stopImmediate && facesOf && addListener) {
        const unseen = (event) => {
          try {
            const faces = facesOf.call(event);
            const onlyOurs = Array.prototype.every.call(faces, (face) => ours.has(face));
            if (onlyOurs && !pageLoading(fontSet)) stopImmediate.call(event);
          } catch (e) {}
        };
        for (const type of ["loading", "loadingdone", "loadingerror"]) {
          try {
            if (outside) outside.apply(addListener, fontSet, [type, outside.callback(unseen, null), true]);
            else addListener.call(fontSet, type, unseen, true);
          } catch (e) {}
        }
      }

      for (const name of shadow) {
        try {
          const made = new RealFontFace(name, "url(data:,)", { unicodeRange: "U+10FFFF" });
          ours.add(made);
          realAdd.call(fontSet, made);
        } catch (e) {}
      }
      for (const font of added.values()) {
        try {
          const made = new RealFontFace(font.name, localsFor(font), { sizeAdjust: `${Number(font.sizeAdjust) || 100}%`, weight: "1 1000" });
          ours.add(made);
          realAdd.call(fontSet, made);
          const loading = made.load();
          if (loading && typeof loading.catch === "function") loading.catch(() => {});
        } catch (e) {}
      }
    });

    // The page's own font list, without them.
    const iterate = (list, kind) => {
      const array = setPrototypeOf(list.map((item) => (kind === "entries" ? setPrototypeOf([item, item], window.Array.prototype) : item)), window.Array.prototype);
      return window.Array.prototype.values.call(array);
    };
    defineGetter(proto, "size", function () { return theirs(this).length; });
    if (setStatusOf) {
      defineGetter(proto, "status", function (value) {
        return value === "loading" && !pageLoading(this) ? "loaded" : value;
      });
    }
    const readyOf = (getOwnPropertyDescriptor(proto, "ready") || {}).get;
    if (readyOf) {
      // Per list: the browser's promise while ours loaded, and the settled
      // one handed out for it.
      const readyFor = new WeakMap();
      defineGetter(proto, "ready", function (value) {
        const kept = readyFor.get(this);
        if (kept && kept.browsers === value && !pageLoading(this)) return kept.handed;
        if (setStatusOf && setStatusOf.call(this) === "loading" && !pageLoading(this)) {
          const handed = resolved(this);
          readyFor.set(this, { browsers: value, handed });
          return handed;
        }
        return value;
      });
    }
    define(proto, "has", (original) => function (item) {
      return ours.has(item) ? false : original.apply(this, arguments);
    });
    define(proto, "delete", (original) => function (item) {
      return ours.has(item) ? false : original.apply(this, arguments);
    });
    define(proto, "clear", (original) => function () {
      for (const item of theirs(this)) realDelete.call(this, item);
    });
    define(proto, "forEach", (original) => function (callback, thisArg) {
      if (typeof callback !== "function") return original.apply(this, arguments);
      for (const item of theirs(this)) Reflect.apply(callback, thisArg, [item, item, this]);
      return undefined;
    });
    for (const kind of ["values", "keys", "entries"]) {
      if (typeof proto[kind] === "function") define(proto, kind, () => function () { return iterate(theirs(this), kind); });
    }
    if (typeof proto[Symbol.iterator] === "function") {
      defineProperty(proto, Symbol.iterator, { value: proto.values, writable: true, enumerable: false, configurable: true });
    }
    define(proto, "load", (original) => function () {
      const result = original.apply(this, arguments);
      return result && typeof result.then === "function" ? result.then((faces) => setPrototypeOf(Array.prototype.filter.call(faces, (item) => !ours.has(item)), window.Array.prototype)) : result;
    });
    // An event of the page's own fonts' and ours together: the page's.
    if (fontFaceSetLoadEvent && facesOf) {
      defineGetter(fontFaceSetLoadEvent.prototype, "fontfaces", (value) => {
        if (!value || typeof value.length !== "number") return value;
        const list = Array.prototype.filter.call(value, (item) => !ours.has(item));
        return list.length === value.length ? value : window.Object.freeze(setPrototypeOf(list, window.Array.prototype));
      });
    }
  }

  // queryLocalFonts (Chrome asks the user first): the list without the
  // fonts the profile hides, in the browser's own array.
  if (isWindow && local.size && typeof window.queryLocalFonts === "function") {
    const fontDataProto = window.FontData && window.FontData.prototype;
    const read = (name) => {
      const descriptor = fontDataProto && getOwnPropertyDescriptor(fontDataProto, name);
      return descriptor && descriptor.get ? (font) => { try { return descriptor.get.call(font); } catch (e) { return ""; } } : (font) => font[name];
    };
    const familyOf = read("family");
    const fullNameOf = read("fullName");
    const postscriptNameOf = read("postscriptName");
    const shown = (font) => ![familyOf(font), fullNameOf(font), postscriptNameOf(font)].some((name) => typeof name === "string" && local.has(lower(name)));
    define(window, "queryLocalFonts", (original) => function () {
      const result = original.apply(this, arguments);
      return result && typeof result.then === "function"
        ? result.then((list) => (Array.isArray(list) ? setPrototypeOf(Array.prototype.filter.call(list, shown), window.Array.prototype) : list))
        : result;
    });
  }

  // A worker's canvas: a hidden font given by name finds nothing, an added
  // one is drawn with the font it is drawn with in the page, and either
  // reads back as the browser writes what was given ('Inter' as Inter),
  // read from a canvas of this script's own.
  if (!isWindow && window.OffscreenCanvasRenderingContext2D && window.OffscreenCanvas && (hidden.size || added.size)) {
    const Context = window.OffscreenCanvasRenderingContext2D;
    const fontOf = getOwnPropertyDescriptor(Context.prototype, "font");
    const RealOffscreenCanvas = window.OffscreenCanvas;
    const getContext = RealOffscreenCanvas.prototype.getContext;
    if (fontOf && fontOf.get && fontOf.set && typeof getContext === "function") {
      const asked = new WeakMap();
      let scratch = null;
      const SENTINEL = "1px " + quoted(missing);
      // How the browser writes `text` as a canvas font, or null where it
      // takes no such font (the canvas keeps the one it had).
      const written = (text) => {
        try {
          if (!scratch) scratch = getContext.call(new RealOffscreenCanvas(1, 1), "2d");
          fontOf.set.call(scratch, SENTINEL);
          const sentinel = fontOf.get.call(scratch);
          fontOf.set.call(scratch, text);
          const value = fontOf.get.call(scratch);
          return value === sentinel ? null : value;
        } catch (e) {
          return null;
        }
      };
      const families = (text) => text.replace(/(["'])([^"']+)\1|([^,\s"'][^,"']*)/g, (whole, q, inQuotes, bare) => {
        const name = (inQuotes !== undefined ? inQuotes : bare).trim();
        const font = added.get(lower(name));
        if (font) return [font.standIn].concat(ELSEWHERE[font.kind] || ["Liberation Sans", "DejaVu Sans"]).map(quoted).join(", ");
        return hidden.has(lower(name)) ? quoted(missing) : whole;
      });
      defineProperty(Context.prototype, "font", {
        get: lookalike(fontOf.get, function () {
          const value = fontOf.get.call(this);
          const mine = asked.get(this);
          return mine && mine.set === value ? mine.asked : value;
        }),
        set: lookalike(fontOf.set, function (value) {
          const text = `${value}`;
          // The size and style come first, the families after the size.
          const at = text.search(/\d(?:[\d.]*)(?:px|pt|em|rem|%|vw|vh|ex|ch)\b(?:\s*\/\s*[^\s]+)?\s+/i);
          const split = at === -1 ? -1 : text.slice(at).search(/\s+/) + at;
          const changed = split > 0 ? text.slice(0, split) + families(text.slice(split)) : text;
          fontOf.set.call(this, changed);
          const shown = changed !== text ? written(text) : null;
          if (shown !== null) asked.set(this, { asked: shown, set: fontOf.get.call(this) });
          else asked.delete(this);
        }),
        configurable: true,
        enumerable: fontOf.enumerable,
      });
    }
  }
}
