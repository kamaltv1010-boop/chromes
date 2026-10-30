"""Builds scripts/protect.js from the iOS app's FingerprintProtection.swift.

Usage: python3 tools/extract_from_ios.py <path to AmirBrowser/FingerprintProtection.swift>

The JavaScript that gives pages noisy canvas, WebGL and audio values, shifted
ClientRects and another screen size lives in the iOS app (the Swift file holds
it as raw strings with a few interpolated seeds and sizes). This takes those
strings as they are, puts `config` values where the Swift interpolations were,
and wraps them as a function `protectPage(window, config)`, so the phone, the
Noor browser and Chrome give the same values for the same seeds. Edit the
Swift file, then rerun this.
"""
import re
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text(encoding="utf-8")
out = Path(__file__).resolve().parent.parent / "scripts" / "protect.js"


def raw(name):
    """The raw string literal that follows `name` in the Swift file."""
    m = re.search(re.escape(name) + r".*?#\"\"\"\n(.*?)\n[ \t]*\"\"\"#", src, re.S)
    if not m:
        sys.exit(f"not found: {name}")
    return m.group(1) + "\n"


def part(name, **replacements):
    text = raw(name)
    for key, value in replacements.items():
        text = text.replace("\\#(" + key + ")", value)
    assert "\\#(" not in text, f"unreplaced interpolation in {name}"
    return text


shared = part("private static let shared")


def swap(text, old, new, what):
    assert text.count(old) == 1, f"{what} not found once"
    return text.replace(old, new)


# One state for the page's copies of the script. Chrome runs the script in
# every document, so each frame of a page and each window it opens has a
# copy of its own; a copy that only knew its own state would give a canvas
# drawn in the page its real pixels when read through a frame's built-ins.
# A copy takes the state of the copy in its parent (or opener), asked
# through that window's Function.prototype.toString with a symbol only the
# copies can make (the app's key for the run, see main/inject.js).
shared = swap(shared, """    // Each replacement's real built-in, for its toString() and for calling it.
    const originals = new WeakMap();
    const native""", """    // Each replacement's real built-in, for its toString() and for calling it
    // (`originals`, below).
    const native""", "originals")
shared = swap(shared, """    // The windows protected from this script, each once.
    const protectedWindows = new WeakSet();
    // The audio buffers the browser rendered or decoded, from any window, and
    // the channels of them already changed.
    const rendered = new WeakSet();
    const nudged = new WeakMap();
    // Each canvas's context: its kind, "webgl" or "canvas", and the settings
    // it was made with, from any window.
    const kinds = new WeakMap();
    // The canvases holding what a device's rendering decided (text, paths,
    // images…), the only ones that get noise, and those a clip limits.
    const painted = new WeakSet();
    const clipped = new WeakSet();
    // Each canvas's (or WebGL context's) candidate pixels, computed lately.
    const marks = new WeakMap();
""", """    // What the copies of this script in a page share: the frames of a page
    // and the windows it opens each run a copy, and one that reaches the copy
    // of its parent or opener takes that one's state, so every copy knows
    // every replacement and every canvas, buffer and context, whichever
    // window's built-ins a page reads them with. The copies ask each other
    // through the other window's Function.prototype.toString, reached through
    // prototypes and property descriptors only (no getter or proxy of a page
    // runs), called with a symbol only they can make, and only once its
    // source shows the mark of this run: a page's own function is never
    // called. Elsewhere (a worker, the top of a tab) a copy starts the state.
    const reflectApply = Reflect.apply;
    const sharedToken = config.key ? Symbol.for(config.key) : null;
    const toStringOf = (object) => {
      try {
        let last = object;
        for (let next = getPrototypeOf(last), i = 0; next !== null && i < 64; next = getPrototypeOf(next), i++) last = next;
        const objectToString = getOwnPropertyDescriptor(last, "toString");
        const functionProto = objectToString && typeof objectToString.value === "function" ? getPrototypeOf(objectToString.value) : null;
        const own = functionProto && getOwnPropertyDescriptor(functionProto, "toString");
        return own && typeof own.value === "function" ? own.value : null;
      } catch (e) {
        return null;
      }
    };
    const shared = (() => {
      if (sharedToken !== null) {
        const near = [];
        try { near.push(window.frameElement); } catch (e) {}
        try { near.push(window.opener); } catch (e) {}
        for (const other of near) {
          try {
            const asked = other ? toStringOf(other) : null;
            if (asked && reflectApply(nativeToString, asked, []).indexOf(MARK) !== -1) {
              const state = reflectApply(asked, sharedToken, []);
              if (state && typeof state === "object" && state.originals) return state;
            }
          } catch (e) {}
        }
      }
      return {
        originals: new WeakMap(),
        // The windows protected, each once.
        protectedWindows: new WeakSet(),
        // The audio buffers the browser rendered or decoded, from any
        // window, and the channels of them already changed.
        rendered: new WeakSet(),
        nudged: new WeakMap(),
        // Each canvas's context: its kind, "webgl" or "canvas", and the
        // settings it was made with, from any window.
        kinds: new WeakMap(),
        // The canvases holding what a device's rendering decided (text,
        // paths, images…), the only ones that get noise, and those a clip
        // limits.
        painted: new WeakSet(),
        clipped: new WeakSet(),
        // Each canvas's (or WebGL context's) candidate pixels, computed lately.
        marks: new WeakMap(),
      };
    })();
    const { originals, protectedWindows, rendered, nudged, kinds, painted, clipped, marks } = shared;
""", "shared state")
helpers = part("private static let helpers")
# A worker held before its first line has no location yet, so a worker's
# script is told the page's host instead.
HOST = "    const host = (() => {\n"
assert HOST in helpers, "host not found in helpers"
helpers = helpers.replace(HOST, "    const host = config.host != null ? String(config.host) : (() => {\n")
# What the app tells the script about where it runs it from (see `hosted` in
# the Swift file, and main/inject.js): the config itself.
HOSTED = "    const hosted = {};\n"
assert HOSTED in helpers, "hosted not found in helpers"
helpers = helpers.replace(HOSTED, "    const hosted = config;\n")
# The copies ask each other for the state through toString (see `shared`).
helpers = swap(helpers, """    window.Function.prototype.toString = lookalike(windowToString, function () {
      const source""", """    window.Function.prototype.toString = lookalike(windowToString, function () {
      if (sharedToken !== null && this === sharedToken) return shared;
      const source""", "toString")
frames = part("private static let framesScript")
# Chrome is Chrome: what the Noor browser adds to look like it (its brands,
# chrome.*, permissions, languages) is Chrome's own here, so only the
# fingerprints are changed.
parts = [
    ("config.seeds.canvas != null", part("func canvasScript", seed="config.seeds.canvas")),
    ("config.seeds.webGL != null", part("func webGLScript", seed="config.seeds.webGL")),
    ("config.seeds.canvas != null || config.seeds.webGL != null", part(
        "func canvasExportScript",
        canvas="(config.seeds.canvas != null ? forSite(config.seeds.canvas) : null)",
        webgl="(config.seeds.webGL != null ? forSite(config.seeds.webGL) : null)",
    )),
    ("config.seeds.audio != null", part("func audioScript", seed="config.seeds.audio")),
    ("config.seeds.clientRects != null", part("func clientRectsScript", seed="config.seeds.clientRects")),
    ("config.screen", part("func screenScript", **{"size.width": "config.screen.width", "size.height": "config.screen.height"})
        # On Windows the taskbar takes the bottom of the screen, so
        # availHeight is less than height. In the frames of a page Chrome
        # itself shows the profile's screen (the app tells it, see
        # main/chrome.js), to CSS as to scripts, so only availHeight is
        # changed there; the others (another site's frames) get it all here.
        .replace('for (const name of ["width", "availWidth"]) defineGetter(window.Screen.prototype, name, () => width);\n'
                 '          for (const name of ["height", "availHeight"]) defineGetter(window.Screen.prototype, name, () => height);',
                 'const shown = (name) => {\n'
                 '            try { return getOwnPropertyDescriptor(window.Screen.prototype, name).get.call(window.screen); } catch (e) { return undefined; }\n'
                 '          };\n'
                 '          const byChrome = shown("width") === width && shown("height") === height;\n'
                 '          if (!byChrome) {\n'
                 '            for (const name of ["width", "availWidth"]) defineGetter(window.Screen.prototype, name, () => width);\n'
                 '            defineGetter(window.Screen.prototype, "height", () => height);\n'
                 '          }\n'
                 '          defineGetter(window.Screen.prototype, "availHeight", () => height - 48);\n'
                 '          if (!byChrome) {')
        .replace('              return written.get(this) || value;\n            });\n          }\n',
                 '              return written.get(this) || value;\n            });\n          }\n          }\n')),
    ("config.hardware", (
        "// Hardware: pages see a common PC's core count and memory instead of\n"
        "// this one's, in workers too.\n"
        "const navigatorProto = (window.Navigator || window.WorkerNavigator).prototype;\n"
        "defineGetter(navigatorProto, \"hardwareConcurrency\", () => config.hardware.cores);\n"
        "defineGetter(navigatorProto, \"deviceMemory\", () => config.hardware.memory);\n"
    )),
]
assert "\\#(" not in shared + helpers + frames, "unreplaced interpolation"

guarded = "".join(f"if ({condition}) {{ try {{\n{text}}} catch (e) {{}} }}\n" for condition, text in parts)
guarded += "try {\n" + frames + "} catch (e) {}\n"
source = (
    "// Generated by tools/extract_from_ios.py from AmirBrowser/FingerprintProtection.swift\n"
    "// of the iOS app (github.com/kamaltv1010-boop/Amir): the same code, so a\n"
    "// page sees the same noise for the same seed on the phone, in the Noor\n"
    "// browser and in Chrome. Don't edit by hand; change the Swift file and\n"
    "// rerun the tool.\n"
    "//\n"
    "// protectPage(window, config) protects a page's window and the empty\n"
    "// frames it makes. config: { seeds: { canvas, webGL, audio, clientRects }\n"
    "// (a number each, or null for off), screen: { width, height } or null,\n"
    "// hardware: { cores, memory } or null, and how the app runs it (see\n"
    "// main/inject.js) }.\n"
    "const protectPage = (window, config) => {\n"
    "\"use strict\";\n"
    + shared
    + "const protect = (window) => {\n"
    + helpers
    + guarded
    + "protectedWindows.add(window);\n};\n"
    + "if (!isProtected(window)) protect(window);\n"
    + "};\n\n"
    + "module.exports = protectPage;\n"
)
out.write_text(source, encoding="utf-8")
print(f"wrote {out}: {len(source)} chars")
