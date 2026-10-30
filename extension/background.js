// Noor for Edge: gives every page, and every frame in it, Canvas, WebGL,
// audio and ClientRects noise before its own first line: Noor's protection
// (protect.js, made from the iPhone app's), with the same values on a site
// at every visit, other values on other sites, and new ones on demand.
//
// The browser runs the extension's files in a page's own world before the
// page's scripts (a content script, registered here as the state changes):
// the bits' files that tell the state, then realm.js, which runs protect.js
// with it (see filesFor in core.js). Nothing else reaches a page, so no
// page can read the state or tell which file ran.
"use strict";
importScripts("core.js");

const { KINDS, normalize, renew, isSite, filesFor, excludeFor } = self.NoorCore;
const SCRIPT_ID = "noor";

const loadState = async () => {
  const stored = await chrome.storage.local.get(["master", "gens", "enabled", "offSites"]);
  const state = normalize(stored);
  if (JSON.stringify(state) !== JSON.stringify({ master: stored.master, gens: stored.gens, enabled: stored.enabled, offSites: stored.offSites })) {
    await chrome.storage.local.set(state);
  }
  return state;
};

const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/// Pages get the protection the state says from their next load: the
/// content script registered anew (and taken away while every protection
/// is off).
const apply = async (state) => {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!KINDS.some((kind) => state.enabled[kind])) {
    if (registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    return;
  }
  const script = {
    id: SCRIPT_ID,
    matches: ["<all_urls>"],
    excludeMatches: excludeFor(state.offSites),
    js: filesFor(state),
    runAt: "document_start",
    allFrames: true,
    // Frames without an address of their own (about:blank, data:, blob:,
    // srcdoc), which a page reads at once, run it too, as they are made.
    matchOriginAsFallback: true,
    world: "MAIN",
    persistAcrossSessions: true,
  };
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([script]);
  } else if (!sameList(registered[0].js, script.js) || !sameList(registered[0].excludeMatches, script.excludeMatches)) {
    await chrome.scripting.updateContentScripts([script]);
  }
};

/// One change at a time: each reads the state the last one left.
let queue = Promise.resolve();
const inOrder = (work) => {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
};

/// What the popup asks: the state, after a change if it asks for one.
const answer = async (message) => {
  let state = await loadState();
  if (message.type === "setEnabled" && KINDS.includes(message.kind)) {
    state.enabled[message.kind] = Boolean(message.on);
  } else if (message.type === "renew" && Array.isArray(message.kinds)) {
    state = renew(state, message.kinds.filter((kind) => KINDS.includes(kind)));
  } else if (message.type === "setSite" && isSite(message.site)) {
    const off = new Set(state.offSites);
    if (message.on) {
      off.delete(message.site);
    } else {
      off.add(message.site);
    }
    state.offSites = [...off].sort();
  } else if (message.type !== "state") {
    throw new Error("Unknown message");
  }
  if (message.type !== "state") {
    await chrome.storage.local.set(state);
  }
  await apply(state);
  // The popup needs no secret: the master stays here.
  return { enabled: state.enabled, offSites: state.offSites };
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only this extension's own pages (the popup) ask.
  if (sender.id !== chrome.runtime.id || !String(sender.url || "").startsWith(chrome.runtime.getURL(""))) {
    return false;
  }
  inOrder(() => answer(message || {})).then(reply, (error) => reply({ error: String((error && error.message) || error) }));
  return true;
});

// Installed, updated, or the worker started again: the registration is
// made sure of (an update may bring other files).
inOrder(async () => apply(await loadState())).catch(() => {});
