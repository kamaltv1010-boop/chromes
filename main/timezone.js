"use strict";
const crypto = require("crypto");

/// The time zone pages see: the one of the public address sites see them
/// come from, as a visitor from there has, so a site that compares the two
/// finds them agreeing: the connection's (a VPN's, when one is on), or for
/// a profile with a proxy, the proxy's, asked through it. It is asked of
/// services that answer without a key, tried in turn; when none answers,
/// pages see the system's. The last one found is kept, to show from the
/// next launch on while it is asked again.
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

/// A fetch that goes through `proxy`, as the profile's Chrome does: a
/// network session of its own (in memory only) told to use the proxy.
const fetchThroughProxy = (proxy) => {
  let ready = null;
  return async (url, options) => {
    const { session } = require("electron");
    if (!ready) {
      const ses = session.fromPartition(`noor-timezone-${crypto.createHash("sha256").update(proxy).digest("hex").slice(0, 16)}`, { cache: false });
      ready = ses.setProxy({ proxyRules: proxy }).then(() => ses);
    }
    const ses = await ready;
    return ses.fetch(url, options);
  };
};

/// Where the zone found through a proxy is kept.
const proxyKey = (proxy) => `timezone.proxy.${crypto.createHash("sha256").update(proxy).digest("hex").slice(0, 16)}`;

class Timezone {
  /// `fetch` and `fetchThrough` (a proxy's fetch) stand in for the network
  /// in tests; `forced` is a zone to show without asking (tests).
  constructor(store, { fetch = (url, options) => require("electron").net.fetch(url, options), fetchThrough = fetchThroughProxy, forced = null } = {}) {
    this.store = store;
    this.fetch = fetch;
    this.fetchThrough = fetchThrough;
    /// Each proxy's fetch, and its lookup under way.
    this.proxies = new Map();
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

  /// The zone a profile's pages see: its proxy's, when it has one (null
  /// until it is found), else the connection's.
  for(proxy) {
    if (!proxy) {
      return this.current;
    }
    if (!this.enabled()) {
      return null;
    }
    if (this.forced) {
      return this.forced;
    }
    const known = this.store.get(proxyKey(proxy), null);
    return isZone(known) ? known : null;
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

  /// The address's zone from the first service that answers (through
  /// `fetch`), or null.
  async lookup(fetch = this.fetch) {
    for (const service of SERVICES) {
      try {
        const response = await fetch(service.url, {
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

  /// Asks through `proxy` (once at a time), and keeps the zone found for it.
  refreshProxy(proxy) {
    if (!proxy || this.forced) {
      return Promise.resolve();
    }
    let entry = this.proxies.get(proxy);
    if (!entry) {
      entry = { fetch: this.fetchThrough(proxy), asking: null };
      this.proxies.set(proxy, entry);
    }
    if (!entry.asking) {
      entry.asking = this.lookup(entry.fetch).then((zone) => {
        entry.asking = null;
        if (zone && zone !== this.store.get(proxyKey(proxy), null)) {
          this.store.set(proxyKey(proxy), zone);
          this.notify();
        }
      }, () => { entry.asking = null; });
    }
    return entry.asking;
  }

  /// The zone of `proxy`, asked first if it isn't known yet (for at most
  /// `ms`): what a profile opening with that proxy shows from its first page.
  async forOpening(proxy, ms = 8000) {
    if (proxy && this.enabled() && !this.for(proxy)) {
      await Promise.race([this.refreshProxy(proxy), new Promise((resolve) => setTimeout(resolve, ms))]);
    } else if (proxy && this.enabled()) {
      this.refreshProxy(proxy);
    }
    return this.for(proxy);
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

module.exports = { Timezone, isZone, SERVICES, proxyKey };
