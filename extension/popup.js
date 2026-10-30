// The popup: the protections, each turned on or off and given new values,
// and the site of the tab in use, turned off or on.
"use strict";
const { KINDS, siteOf } = self.NoorCore;

const text = (key) => chrome.i18n.getMessage(key) || key;
document.documentElement.lang = chrome.i18n.getUILanguage();
// The direction of the messages shown, which the browser picks by its language.
document.documentElement.dir = text("dir") === "rtl" ? "rtl" : "ltr";
for (const element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = text(element.dataset.i18n);
}

const $ = (id) => document.getElementById(id);

const ask = async (message) => {
  const answer = await chrome.runtime.sendMessage(message);
  if (!answer || answer.error) {
    throw new Error(answer ? answer.error : "No answer");
  }
  return answer;
};

let tab = null;
let site = null;

const rows = {};
for (const kind of KINDS) {
  const row = document.createElement("div");
  row.className = "row";
  const words = document.createElement("div");
  words.className = "text";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = text(kind);
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = text(`${kind}Hint`);
  words.append(label, hint);
  const renew = document.createElement("button");
  renew.textContent = text("newValues");
  renew.title = text("newValuesTitle");
  renew.addEventListener("click", () => change({ type: "renew", kinds: [kind] }));
  const toggle = document.createElement("label");
  toggle.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", text(kind));
  input.addEventListener("change", () => change({ type: "setEnabled", kind, on: input.checked }));
  toggle.append(input, document.createElement("span"));
  row.append(words, renew, toggle);
  $("kinds").append(row);
  rows[kind] = { input, renew };
}

const render = ({ enabled, offSites }) => {
  for (const kind of KINDS) {
    rows[kind].input.checked = enabled[kind];
    rows[kind].renew.disabled = !enabled[kind];
  }
  $("changeAll").disabled = !KINDS.some((kind) => enabled[kind]);
  $("site").hidden = !site;
  $("notWeb").hidden = Boolean(site);
  if (site) {
    const on = !offSites.includes(site);
    $("siteName").textContent = site;
    $("siteState").textContent = text(on ? "siteOn" : "siteOff");
    $("siteOn").checked = on;
  }
};

const show = (key) => {
  $("note").textContent = text(key);
};

/// A change, then the tab in use loads again to take it (a site's page).
const change = async (message) => {
  try {
    render(await ask(message));
    if (tab && site) {
      await chrome.tabs.reload(tab.id);
      show("changed");
    }
  } catch (error) {
    show("failed");
    ask({ type: "state" }).then(render, () => {});
  }
};

$("siteOn").addEventListener("change", () => change({ type: "setSite", site, on: $("siteOn").checked }));
$("changeAll").addEventListener("click", () => change({ type: "renew", kinds: KINDS }));

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  site = tab ? siteOf(tab.url || "") : null;
  render(await ask({ type: "state" }));
  requestAnimationFrame(() => document.body.classList.add("ready"));
})().catch(() => show("failed"));
