"use strict";

/// A profile's cookies, as its Chrome has them. Chrome keeps them on the
/// disk encrypted with a key only it can read, so they are asked of Chrome
/// itself, through its debugging protocol (Storage.getCookies and
/// setCookies, on the browser): with the profile's Chrome open, or Chrome
/// started for this alone, with no window, then closed again (see
/// withChrome in main.js).
///
/// Two file formats: cookies.txt (Netscape's: what curl, yt-dlp and most
/// cookie extensions read and write), and JSON (the list as Chrome gives
/// it, every field kept).

/// The fields of a cookie as Storage.setCookies takes them, from one as
/// Storage.getCookies gives it (or as a file had it), or null if it is no
/// cookie.
const settable = (cookie) => {
  if (!cookie || typeof cookie !== "object") {
    return null;
  }
  const name = typeof cookie.name === "string" ? cookie.name : "";
  const value = typeof cookie.value === "string" ? cookie.value : "";
  const domain = typeof cookie.domain === "string" ? cookie.domain.trim() : "";
  if (!domain || /[\s;,]/.test(domain) || name.length + value.length > 8192 || /[\r\n\0]/.test(name + value)) {
    return null;
  }
  const out = {
    name,
    value,
    domain,
    path: typeof cookie.path === "string" && cookie.path.startsWith("/") ? cookie.path : "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
  };
  // A session cookie has no expiry (-1 or none); a date in seconds otherwise.
  const expires = Number(cookie.expires);
  if (Number.isFinite(expires) && expires > 0 && !cookie.session) {
    out.expires = expires;
  }
  if (["Strict", "Lax", "None"].includes(cookie.sameSite)) {
    out.sameSite = cookie.sameSite;
  }
  // SameSite=None needs Secure, as Chrome demands.
  if (out.sameSite === "None") {
    out.secure = true;
  }
  if (cookie.partitionKey && typeof cookie.partitionKey === "object" && typeof cookie.partitionKey.topLevelSite === "string") {
    out.partitionKey = { topLevelSite: cookie.partitionKey.topLevelSite, hasCrossSiteAncestor: Boolean(cookie.partitionKey.hasCrossSiteAncestor) };
  }
  return out;
};

/// cookies.txt: one line a cookie, seven fields apart by tabs: domain,
/// whether its subdomains get it, path, secure, expiry (seconds, 0 for a
/// session cookie), name, value; an HttpOnly cookie's line starts with
/// "#HttpOnly_".
const toNetscape = (cookies) => {
  const lines = ["# Netscape HTTP Cookie File", "# Made by Noor for Chrome: this profile's cookies. Keep this file to yourself: it signs you in.", ""];
  for (const cookie of cookies) {
    const c = settable(cookie);
    if (!c) {
      continue;
    }
    const domain = c.domain;
    const fields = [
      (c.httpOnly ? "#HttpOnly_" : "") + domain,
      domain.startsWith(".") ? "TRUE" : "FALSE",
      c.path,
      c.secure ? "TRUE" : "FALSE",
      String(Math.floor(c.expires || 0)),
      c.name,
      c.value,
    ];
    lines.push(fields.join("\t"));
  }
  return lines.join("\n") + "\n";
};

const fromNetscape = (text) => {
  const cookies = [];
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw;
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length < 7) {
      continue;
    }
    const [domain, , path, secure, expiry, name, ...rest] = fields;
    const expires = Number(expiry);
    const cookie = settable({
      domain,
      path,
      secure: secure.toUpperCase() === "TRUE",
      httpOnly,
      expires: expires > 0 ? expires : undefined,
      session: !(expires > 0),
      name,
      value: rest.join("\t"),
    });
    if (cookie) {
      cookies.push(cookie);
    }
  }
  return cookies;
};

const toJSON = (cookies) => JSON.stringify(cookies.map(settable).filter(Boolean), null, 2) + "\n";

/// Cookies from a file's text, whichever of the two formats it is (a JSON
/// list, or an object with a "cookies" list, as some extensions write).
const parseCookies = (text) => {
  const trimmed = String(text).replace(/^﻿/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      throw new Error("This JSON file can't be read");
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.cookies) ? data.cookies : null;
    if (!list) {
      throw new Error("This JSON file holds no list of cookies");
    }
    // (Some extensions write expirationDate, hostOnly and sameSite in lower case.)
    return list.map((c) => settable(c && typeof c === "object" ? {
      ...c,
      expires: c.expires !== undefined ? c.expires : c.expirationDate,
      session: c.session === true || (c.expires === undefined && c.expirationDate === undefined),
      sameSite: typeof c.sameSite === "string" ? ({ strict: "Strict", lax: "Lax", none: "None", no_restriction: "None" })[c.sameSite.toLowerCase()] || c.sameSite : undefined,
    } : c)).filter(Boolean);
  }
  return fromNetscape(text);
};

/// What the window lists of a cookie: no value (it signs in), its site,
/// name, path, when it ends, and its flags.
const summary = (cookie) => ({
  domain: String(cookie.domain || ""),
  name: String(cookie.name || ""),
  path: String(cookie.path || "/"),
  expires: cookie.session || !(Number(cookie.expires) > 0) ? null : Number(cookie.expires),
  secure: Boolean(cookie.secure),
  httpOnly: Boolean(cookie.httpOnly),
  sameSite: cookie.sameSite || "",
  size: String(cookie.name || "").length + String(cookie.value || "").length,
});

/// The cookies grouped by site (the domain without its leading dot), the
/// sites with the most first, as the window shows them.
const bySite = (cookies) => {
  const sites = new Map();
  for (const cookie of cookies) {
    const site = String(cookie.domain || "").replace(/^\./, "");
    if (!sites.has(site)) {
      sites.set(site, []);
    }
    sites.get(site).push(summary(cookie));
  }
  return [...sites.entries()]
    .map(([site, list]) => ({ site, cookies: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.cookies.length - a.cookies.length || a.site.localeCompare(b.site));
};

module.exports = { settable, toNetscape, fromNetscape, toJSON, parseCookies, summary, bySite };
