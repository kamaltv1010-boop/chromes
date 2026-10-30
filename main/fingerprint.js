"use strict";
const crypto = require("crypto");

/// The protections, each with a seed per profile that decides the values
/// pages see. The noise ones give canvas, WebGL and audio values and
/// ClientRects that differ from this PC's but stay the same on a site;
/// "screen" and "hardware" show another common PC's screen size, core
/// count and memory. Whether each is on is one setting for all profiles.
const KINDS = ["canvas", "webGL", "audio", "clientRects", "screen", "hardware"];
const NOISE_KINDS = ["canvas", "webGL", "audio", "clientRects"];

/// Common PC screens, in CSS pixels.
const SCREENS = [
  [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080],
  [1920, 1200], [2560, 1080], [2560, 1440], [2560, 1600], [3440, 1440], [3840, 2160],
].map(([width, height]) => ({ width, height }));

/// Core counts common on PCs. Chrome reports memory as 8 GB at most, so
/// that is what every choice shows.
const HARDWARE = [4, 6, 8, 12, 16].map((cores) => ({ cores, memory: 8 }));

/// The memory Chrome tells pages (navigator.deviceMemory) for `bytes` of
/// RAM: the nearest power of two, from 0.25 to 8 GB.
const deviceMemory = (bytes) => {
  const mb = Math.max(1, Math.floor(bytes / (1024 * 1024)));
  const lower = 2 ** Math.floor(Math.log2(mb));
  const nearest = mb - lower <= lower * 2 - mb ? lower : lower * 2;
  return Math.min(8, Math.max(0.25, nearest / 1024));
};

class Fingerprint {
  constructor(store, profiles) {
    this.store = store;
    this.profiles = profiles;
    /// This PC's screen in CSS pixels, and its cores and memory as Chrome
    /// tells pages, set at launch.
    this.realScreen = { width: 0, height: 0 };
    this.realHardware = { cores: 0, memory: 0 };
  }

  enabledKey(kind) {
    return `protection.${kind}`;
  }

  /// Every protection is on at first but audio and ClientRects: on a PC
  /// the audio fingerprint is nearly the same for everyone with the same
  /// Chrome, and the measured sizes of elements the same for everyone with
  /// the same Windows and fonts, so noise there would single the browser
  /// out rather than hide it.
  isEnabled(kind) {
    const value = this.store.get(this.enabledKey(kind));
    return typeof value === "boolean" ? value : kind !== "audio" && kind !== "clientRects";
  }

  setEnabled(kind, isOn) {
    this.store.set(this.enabledKey(kind), Boolean(isOn));
  }

  seedKey(kind, profile) {
    return this.profiles.key(`seed.${kind}`, profile);
  }

  seed(kind, profile) {
    const saved = this.store.get(this.seedKey(kind, profile));
    return Number.isInteger(saved) ? saved >>> 0 : this.newSeed(kind, profile);
  }

  /// A new seed for a kind. A new screen size or hardware must actually
  /// differ, when there is another one to pick.
  newSeed(kind, profile) {
    const old = this.store.get(this.seedKey(kind, profile));
    const canChange = this.choices(kind) > 1;
    let seed;
    for (let attempt = 0; attempt < 32; attempt++) {
      seed = crypto.randomBytes(4).readUInt32LE(0);
      if (!canChange || !Number.isInteger(old) || this.visibleValue(seed, kind) !== this.visibleValue(old >>> 0, kind)) {
        break;
      }
    }
    this.store.set(this.seedKey(kind, profile), seed);
    return seed;
  }

  newSeeds(kinds, profile) {
    for (const kind of kinds) {
      this.newSeed(kind, profile);
    }
  }

  /// The screens pages may see: those at least as big as this PC's, since
  /// a window bigger than the screen happens on no real PC.
  screens() {
    const fitting = SCREENS.filter((s) => s.width >= this.realScreen.width && s.height >= this.realScreen.height);
    return fitting.length ? fitting : [SCREENS[SCREENS.length - 1]];
  }

  pick(seed, list) {
    return list[seed % list.length];
  }

  screen(profile) {
    return this.pick(this.seed("screen", profile), this.screens());
  }

  hardware(profile) {
    return this.pick(this.seed("hardware", profile), HARDWARE);
  }

  /// What a profile's pages see of the screen and hardware: the profile's,
  /// or this PC's own while that protection is off.
  shown(profile) {
    const screen = this.isEnabled("screen");
    const hardware = this.isEnabled("hardware");
    return {
      screen: screen ? this.screen(profile) : this.realScreen,
      hardware: hardware ? this.hardware(profile) : this.realHardware,
      realScreen: !screen,
      realHardware: !hardware,
    };
  }

  visibleValue(seed, kind) {
    if (kind === "screen") {
      const s = this.pick(seed, this.screens());
      return `${s.width}x${s.height}`;
    }
    if (kind === "hardware") {
      return String(this.pick(seed, HARDWARE).cores);
    }
    return String(seed);
  }

  choices(kind) {
    if (kind === "screen") {
      return new Set(this.screens().map((s) => `${s.width}x${s.height}`)).size;
    }
    if (kind === "hardware") {
      return HARDWARE.length;
    }
    return Infinity;
  }

  /// What a profile's pages get: the seeds of the protections that are on,
  /// and the screen and hardware (left out by the page itself on a sign-in
  /// site, which checks them against the device).
  config(profile) {
    const seeds = {};
    for (const kind of NOISE_KINDS) {
      seeds[kind] = this.isEnabled(kind) ? this.seed(kind, profile) : null;
    }
    return {
      seeds,
      screen: this.isEnabled("screen") ? this.screen(profile) : null,
      hardware: this.isEnabled("hardware") ? this.hardware(profile) : null,
    };
  }
}

module.exports = { Fingerprint, KINDS, NOISE_KINDS, SCREENS, HARDWARE, deviceMemory };
