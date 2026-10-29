"use strict";
const { net } = require("electron");

/// The time zone pages see: the one of the connection's public address (a
/// VPN's, when one is on), as a visitor from there has, so a site that
/// compares the two finds them agreeing. It is asked of services that
/// answer without a key, tried in turn; when none answers, pages see the
/// system's. The last one found is kept, to show from the next launch on
/// while it is asked again.
const SERVICES = [
  { url: "https://ipwho.is/", zone: (data) => data && data.timezone && data.timezone.id },
  { url: "https://ipapi.co/json/", zone: (data) => data && data.timezone },
  { url: "https://ipinfo.io/json", zone: (data) => data && data.timezone },
  { url: "https://freeipapi.com/api/json", zone: (data) => data && Array.isArray(data.timeZones) ? data.timeZones[0] : null },
];
const REFRESH_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 6000;

/// Whether `id` names a time zone the browser knows ("Europe/Paris").
const isZone = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(id)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id });
    return true;
  } catch (error) {
    return false;
  }
};

class Timezone {
  /// `fetch` stands in for the network in tests; `forced` is a zone to
  /// show without asking (tests).
  constructor(store, { fetch = (url, options) => net.fetch(url, options), forced = null } = {}) {
    this.store = store;
    this.fetch = fetch;
    this.forced = isZone(forced) ? forced : null;
    const last = store.get("timezone.last", null);
    this.zone = isZone(last) ? last : null;
    this.listeners = [];
    this.timer = null;
    this.first = null;
  }

  enabled() {
    return Boolean(this.store.get("timezoneFromIP", true));
  }

  setEnabled(isOn) {
    this.store.set("timezoneFromIP", Boolean(isOn));
    this.notify();
  }

  /// The zone pages see, or null for the system's.
  get current() {
    return this.enabled() ? this.forced || this.zone : null;
  }

  onChange(listener) {
    this.listeners.push(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (error) {
        // A listener's failure is its own.
      }
    }
  }

  /// The address's zone from the first service that answers, or null.
  async lookup() {
    for (const service of SERVICES) {
      try {
        const response = await this.fetch(service.url, {
          cache: "no-store",
          credentials: "omit",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          continue;
        }
        const zone = service.zone(await response.json());
        if (isZone(zone)) {
          return zone;
        }
      } catch (error) {
        // The next service may answer.
      }
    }
    return null;
  }

  async refresh() {
    if (this.forced) {
      return;
    }
    const zone = await this.lookup();
    if (zone && zone !== this.zone) {
      this.zone = zone;
      this.store.set("timezone.last", zone);
      this.notify();
    }
  }

  /// Asks now, and again every so often (an address changes when a VPN
  /// goes on or off).
  start() {
    if (this.timer) {
      return;
    }
    this.first = this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  /// Resolves once the first lookup is done, or after `ms` at most.
  ready(ms = 2500) {
    return Promise.race([this.first || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, ms))]);
  }
}

module.exports = { Timezone, isZone, SERVICES };
