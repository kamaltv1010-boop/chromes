"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Timezone } = require("../main/timezone");
const { tempStore } = require("./helpers");

/// A network where every service answers `zone` (as ipwho.is does).
const answering = (zone) => async () => ({ ok: true, json: async () => ({ timezone: { id: zone } }) });

test("a profile with a proxy sees its proxy's time zone, found through the proxy", async () => {
  const store = tempStore();
  const through = [];
  const options = {
    fetch: answering("Africa/Casablanca"),
    fetchThrough: (proxy) => {
      through.push(proxy);
      return answering(proxy.includes("us.") ? "America/New_York" : "Europe/Berlin");
    },
  };
  const zones = new Timezone(store, options);
  await zones.refresh();
  assert.equal(zones.for(""), "Africa/Casablanca");
  assert.equal(zones.for("socks5://us.example:1080"), null);
  assert.equal(await zones.forOpening("socks5://us.example:1080"), "America/New_York");
  assert.equal(await zones.forOpening("http://de.example:8080"), "Europe/Berlin");
  assert.deepEqual(through, ["socks5://us.example:1080", "http://de.example:8080"]);
  // Kept for the next launch, and asked again (once at a time) as it opens.
  const next = new Timezone(store, options);
  assert.equal(next.for("socks5://us.example:1080"), "America/New_York");
  // Off, every profile sees the system's.
  zones.setEnabled(false);
  assert.equal(zones.for("socks5://us.example:1080"), null);
  assert.equal(zones.for(""), null);
});

test("a proxy that doesn't answer leaves its profile on no zone rather than the computer's", async () => {
  const zones = new Timezone(tempStore(), { fetch: answering("Africa/Casablanca"), fetchThrough: () => async () => { throw new Error("proxy down"); } });
  await zones.refresh();
  assert.equal(await zones.forOpening("socks5://down.example:1080", 50), null);
});
