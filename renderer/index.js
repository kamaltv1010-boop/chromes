(() => {
  const $ = (id) => document.getElementById(id);
  const KIND_TITLES = {
    canvas: ["Canvas", "Drawings get noise a site can't tell from the real thing."],
    webGL: ["WebGL", "3D drawings get the same noise."],
    audio: ["Audio", "Sound processing gets noise. Off at first: on a PC this value is nearly the same for everyone with the same Chrome, so noise would stand out."],
    clientRects: ["ClientRects", "Measured sizes of elements shift slightly. Off at first: on a PC these sizes are the same for everyone with the same Windows and fonts, so a shift would stand out."],
    screen: ["Screen Size", "Sites see another common PC screen."],
    hardware: ["Processor & Memory", "Sites see another common core count."],
  };
  let settings = null;

  const row = (label, hint, control) => {
    const element = document.createElement("div");
    element.className = "row";
    const text = document.createElement("div");
    text.className = "label";
    text.textContent = label;
    if (hint) {
      const small = document.createElement("small");
      small.textContent = hint;
      text.append(small);
    }
    element.append(text, control);
    return element;
  };

  const button = (label, className, onClick) => {
    const element = document.createElement("button");
    element.className = "button small " + className;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  };

  const menuButton = (items) => {
    const menu = document.createElement("div");
    menu.className = "menu";
    const toggle = button("⋯", "secondary", (event) => {
      event.stopPropagation();
      const wasOpen = menu.classList.contains("open");
      for (const other of document.querySelectorAll(".menu.open")) other.classList.remove("open");
      if (!wasOpen) menu.classList.add("open");
    });
    const list = document.createElement("div");
    list.className = "items";
    for (const [label, onClick, className] of items) {
      const item = document.createElement("button");
      item.textContent = label;
      if (className) item.className = className;
      item.addEventListener("click", () => { menu.classList.remove("open"); onClick(); });
      list.append(item);
    }
    menu.append(toggle, list);
    return menu;
  };

  const apply = (next) => {
    settings = next;
    const profiles = $("profiles");
    profiles.textContent = "";
    for (const profile of settings.profiles) {
      const element = document.createElement("div");
      element.className = "profile";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = profile.name;
      const details = document.createElement("small");
      details.textContent = `${profile.screen.width} × ${profile.screen.height} · ${profile.hardware.cores} cores · ${profile.hardware.memory} GB`
        + (profile.proxy ? ` · proxy ${profile.proxy}` + (settings.timezoneFromIP ? ` · ${profile.zone || "time zone not found yet"}` : "") : "");
      name.append(details);
      const controls = document.createElement("div");
      controls.style.display = "flex";
      controls.style.gap = "8px";
      controls.style.alignItems = "center";
      if (profile.running) {
        const mark = document.createElement("span");
        mark.className = "running";
        mark.textContent = "Open";
        controls.append(mark, button("Close", "secondary", () => noor.invoke("chrome:close", profile.id).then(apply)));
      } else {
        controls.append(button("Open Chrome", "", () => noor.invoke("chrome:open", profile.id).then(apply)));
      }
      controls.append(menuButton([
        ["New fingerprints", () => noor.invoke("fingerprint:new", profile.id).then(apply)],
        ["Rename…", () => { const value = prompt("Profile name", profile.name); if (value !== null) noor.invoke("profiles:rename", profile.id, value).then(apply); }],
        ["Proxy…", () => { const value = prompt("Proxy, like socks5://host:1080 or http://host:8080 (empty for none)", profile.proxy || ""); if (value !== null) noor.invoke("profiles:proxy", profile.id, value).then(apply); }],
        ["Delete", () => noor.invoke("profiles:remove", profile.id).then(apply), "danger"],
      ]));
      element.append(name, controls);
      profiles.append(element);
    }
    $("newname").placeholder = `Profile ${settings.profiles.length + 1}`;

    const template = $("template");
    template.textContent = "";
    const extensions = settings.template.extensions;
    const controls = settings.template.running
      ? button("Close", "secondary", () => noor.invoke("chrome:close", settings.template.id).then(apply))
      : button("Open Chrome", "", () => noor.invoke("chrome:open", settings.template.id).then(apply));
    template.append(row(
      extensions.length ? `${extensions.length} extension${extensions.length === 1 ? "" : "s"}` : "No extensions yet",
      settings.template.running ? "Open: add or remove extensions in its Chrome." : "New profiles get what is installed here.",
      controls,
    ));
    for (const extension of extensions) {
      const state = document.createElement("span");
      state.className = "value";
      state.textContent = [extension.version, extension.enabled ? "" : "off", extension.unpacked ? "unpacked" : ""].filter(Boolean).join(" · ");
      template.append(row(extension.name, "", state));
    }

    const chrome = $("chromestatus");
    chrome.className = settings.chromePath ? "status" : "status warn";
    chrome.textContent = settings.chromePath ? "" : "Google Chrome wasn't found on this PC. Install it, or choose chrome.exe in Settings.";
    $("chromepath").textContent = settings.chromePath || "Not found";

    const protections = $("protections");
    protections.textContent = "";
    for (const [kind, [title, hint]] of Object.entries(KIND_TITLES)) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(settings.protections[kind]);
      box.addEventListener("change", () => noor.invoke("settings:set", "protection." + kind, box.checked).then(apply));
      protections.append(row(title, hint, box));
    }
    for (const box of document.querySelectorAll("input[data-setting]")) {
      box.checked = Boolean(settings[box.dataset.setting]);
    }
    $("timezonehint").textContent = settings.timezoneFromIP
      ? (settings.timezone
        ? `Pages see ${settings.timezone}, the time zone where your connection is (a VPN's), as a visitor from there would; a profile with a proxy sees its proxy's.`
        : "Pages see the time zone where your connection is (a profile with a proxy, its proxy's). It couldn't be found yet; pages see this PC's for now.")
      : "Pages see this PC's time zone. On, they see the one where your connection is (a VPN's, or a profile's proxy).";
    $("version").textContent = settings.version;
  };

  for (const box of document.querySelectorAll("input[data-setting]")) {
    box.addEventListener("change", () => noor.invoke("settings:set", box.dataset.setting, box.checked).then(apply));
  }
  $("add").addEventListener("click", () => {
    noor.invoke("profiles:add", $("newname").value).then((next) => { $("newname").value = ""; apply(next); });
  });
  $("newname").addEventListener("keydown", (event) => { if (event.key === "Enter") $("add").click(); });
  $("choosechrome").addEventListener("click", () => noor.invoke("chrome:choose").then(apply));
  $("source").addEventListener("click", (event) => { event.preventDefault(); noor.invoke("open:link", event.currentTarget.href); });
  document.addEventListener("click", () => { for (const menu of document.querySelectorAll(".menu.open")) menu.classList.remove("open"); });
  noor.on("state", apply);
  noor.invoke("state").then(apply);
})();
