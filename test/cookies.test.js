"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { settable, toNetscape, fromNetscape, toJSON, parseCookies, bySite } = require("../main/cookies");

// As Chrome's Storage.getCookies gives them.
const FROM_CHROME = [
  { name: "sid", value: "abc=123", domain: ".example.com", path: "/", expires: 1893456000.5, size: 10, httpOnly: true, secure: true, session: false, sameSite: "Lax", priority: "Medium" },
  { name: "pref", value: "dark", domain: "www.example.com", path: "/app", expires: -1, size: 8, httpOnly: false, secure: false, session: true, priority: "Medium" },
  { name: "x", value: "1", domain: "other.test", path: "/", expires: 1893456000, httpOnly: false, secure: false, session: false, sameSite: "None" },
];

test("settable: what Storage.setCookies takes; a session cookie has no expiry; SameSite=None is Secure", () => {
  assert.deepEqual(settable(FROM_CHROME[0]), { name: "sid", value: "abc=123", domain: ".example.com", path: "/", secure: true, httpOnly: true, expires: 1893456000.5, sameSite: "Lax" });
  assert.deepEqual(settable(FROM_CHROME[1]), { name: "pref", value: "dark", domain: "www.example.com", path: "/app", secure: false, httpOnly: false });
  assert.equal(settable(FROM_CHROME[2]).secure, true);
  assert.equal(settable({ name: "a", value: "b" }), null, "no domain: no cookie");
  assert.equal(settable({ name: "a\nb", value: "c", domain: "x.test" }), null, "a line break can't be in a cookie");
  assert.equal(settable({ name: "a", value: "b", domain: "x test" }), null);
});

test("cookies.txt: written and read back the same, HttpOnly kept, subdomains by the leading dot", () => {
  const text = toNetscape(FROM_CHROME);
  const lines = text.split("\n");
  assert.equal(lines[0], "# Netscape HTTP Cookie File");
  assert.ok(lines.includes("#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1893456000\tsid\tabc=123"));
  assert.ok(lines.includes("www.example.com\tFALSE\t/app\tFALSE\t0\tpref\tdark"));
  const back = fromNetscape(text);
  assert.equal(back.length, 3);
  assert.deepEqual(back[0], { name: "sid", value: "abc=123", domain: ".example.com", path: "/", secure: true, httpOnly: true, expires: 1893456000 });
  assert.equal(back[1].expires, undefined, "a session cookie stays one");
  // A value with a tab in it keeps it.
  assert.equal(fromNetscape("a.test\tFALSE\t/\tFALSE\t0\tn\tv1\tv2\n")[0].value, "v1\tv2");
});

test("parseCookies: cookies.txt, Chrome's JSON, and an extension's JSON (expirationDate, lower-case sameSite)", () => {
  assert.equal(parseCookies(toNetscape(FROM_CHROME)).length, 3);
  assert.deepEqual(parseCookies(toJSON(FROM_CHROME)), FROM_CHROME.map(settable));
  const extension = JSON.stringify([{ domain: ".site.test", name: "t", value: "v", path: "/", expirationDate: 1893456000, httpOnly: false, secure: true, sameSite: "no_restriction", hostOnly: false }]);
  assert.deepEqual(parseCookies(extension), [{ name: "t", value: "v", domain: ".site.test", path: "/", secure: true, httpOnly: false, expires: 1893456000, sameSite: "None" }]);
  assert.deepEqual(parseCookies(JSON.stringify({ cookies: [FROM_CHROME[1]] })), [settable(FROM_CHROME[1])]);
  assert.throws(() => parseCookies("{ not json"), /can't be read/);
  assert.throws(() => parseCookies('{"a":1}'), /no list of cookies/);
});

test("bySite: grouped by site, the busiest first, with no values in what the window shows", () => {
  const sites = bySite(FROM_CHROME.concat([{ name: "y", value: "2", domain: "other.test", path: "/" }]));
  // other.test has two: first; the rest by name.
  assert.deepEqual(sites.map((s) => s.site), ["other.test", "example.com", "www.example.com"]);
  assert.deepEqual(sites[0].cookies.map((c) => c.name), ["x", "y"]);
  for (const site of sites) {
    for (const cookie of site.cookies) assert.equal(cookie.value, undefined);
  }
  assert.equal(sites.find((s) => s.site === "www.example.com").cookies[0].expires, null, "a session cookie ends with the session");
});
