(() => {
  const $ = (id) => document.getElementById(id);
  /// A question in the window itself (Electron has no window.prompt: it
  /// throws): a value to type (`value`, given or "") or, with `value`
  /// null, a yes or no. Settles with what was typed (true for a yes), or
  /// null if it was cancelled.
  const ask = ({ title, text = "", value = null, ok = "OK" }) => new Promise((resolve) => {
    const dialog = $("ask");
    const input = $("ask-value");
    $("ask-title").textContent = title;
    $("ask-text").textContent = text;
    $("ask-ok").textContent = ok;
    input.hidden = value === null;
    input.value = value === null ? "" : String(value);
    let answer = null;
    const done = (yes) => { answer = yes ? (value === null ? true : input.value) : null; dialog.close(); };
    $("ask-ok").onclick = () => done(true);
    $("ask-cancel").onclick = () => done(false);
    input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); done(true); } };
    dialog.onclose = () => resolve(answer);
    dialog.showModal();
    if (value !== null) input.select(); else $("ask-ok").focus();
  });
  const KIND_TITLES = {
    canvas: ["Canvas", "Drawings get noise a site can't tell from the real thing."],
    webGL: ["WebGL", "3D drawings get the same noise."],
    gpu: ["WebGL Vendor & Renderer", "Sites see a common PC graphics card's name instead of this PC's."],
    audio: ["Audio", "Sound processing gets noise. Off at first: on a PC this value is nearly the same for everyone with the same Chrome, so noise would stand out."],
    clientRects: ["ClientRects", "Measured sizes of elements shift slightly. Off at first: on a PC these sizes are the same for everyone with the same Windows and fonts, so a shift would stand out."],
    screen: ["Screen Size", "Sites see another common PC screen."],
    hardware: ["Processor & Memory", "Sites see another common core count."],
    fonts: ["Fonts", "Sites see the fonts every Windows has and a few others of the profile's own, not the rest of this PC's."],
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
      // What its pages see: this PC's own screen and hardware while those
      // protections are off.
      details.textContent = [
        `${profile.realScreen ? "this PC's screen " : ""}${profile.screen.width} × ${profile.screen.height}`,
        `${profile.realHardware ? "this PC's " : ""}${profile.hardware.cores} cores · ${profile.hardware.memory} GB`,
        profile.gpu ? profile.gpu : "this PC's graphics card",
        // Its fonts beyond Windows' own (see main/fonts.js).
        profile.fonts ? `fonts: Windows'${profile.fonts.groups.length ? " + " + profile.fonts.groups.join(", ") : ""}${profile.fonts.singles.length ? ` + ${profile.fonts.singles.length} more` : ""}` : "",
        profile.extensions ? `${profile.extensions} extension${profile.extensions === 1 ? "" : "s"}` : "",
        profile.proxy ? `proxy ${profile.proxy}` + (settings.timezoneFromIP ? ` · ${profile.zone || "time zone not found yet"}` : "") : "",
        profile.burner ? "deleted when Chrome closes" : "",
      ].filter(Boolean).join(" · ");
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
        ["Cookies…", () => cookies.show(profile)],
        [`${profile.burner ? "✓ " : ""}Delete when Chrome closes`, () => {
          if (profile.burner) noor.invoke("profiles:burner", profile.id, false).then(apply);
          else ask({ title: `Delete "${profile.name}" when its Chrome closes?`, text: "Its cookies, logins, extensions, history and fingerprints go as its Chrome closes, and a new profile is made in its place each time.", ok: "Delete when closed" }).then((yes) => { if (yes) noor.invoke("profiles:burner", profile.id, true).then(apply); });
        }],
        ["Rename…", () => ask({ title: "Rename profile", value: profile.name, ok: "Rename" }).then((value) => { if (value !== null) noor.invoke("profiles:rename", profile.id, value).then(apply); })],
        ["Proxy…", () => ask({ title: `Proxy of ${profile.name}`, text: "Like socks5://host:1080 or http://host:8080; empty for none.", value: profile.proxy || "", ok: "Save" }).then((value) => { if (value !== null) noor.invoke("profiles:proxy", profile.id, value).then(apply); })],
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

  // A profile's cookies: its sites and their cookies' names (no values: a
  // cookie signs in), searched; exported, imported, deleted (a site's or
  // all). Each asks the profile's Chrome (see withChrome in main.js).
  const cookies = (() => {
    const dialog = $("cookies");
    let profile = null;
    let sites = [];
    const status = (text, warn) => { $("cookies-status").textContent = text; $("cookies-status").className = warn ? "status warn" : "status"; };
    const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleDateString() : "session");
    const render = () => {
      const list = $("cookies-list");
      list.textContent = "";
      const query = $("cookies-search").value.trim().toLowerCase();
      const shown = sites.filter((s) => !query || s.site.includes(query) || s.cookies.some((c) => c.name.toLowerCase().includes(query)));
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = sites.length ? "No site or cookie matches." : "This profile has no cookies.";
        list.append(empty);
        return;
      }
      for (const site of shown) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        const title = document.createElement("span");
        title.className = "t";
        title.textContent = `${site.site} · ${site.cookies.length} cookie${site.cookies.length === 1 ? "" : "s"}`;
        const remove = document.createElement("button");
        remove.className = "x";
        remove.title = `Delete the cookies of ${site.site}`;
        remove.textContent = "✕";
        remove.addEventListener("click", (event) => { event.preventDefault(); act(() => noor.invoke("cookies:clear", profile.id, site.site), (r) => `Deleted ${r.count} cookie${r.count === 1 ? "" : "s"} of ${site.site}.`, true); });
        summary.append(title, remove);
        details.append(summary);
        for (const cookie of site.cookies) {
          const line = document.createElement("div");
          line.className = "cookie";
          line.textContent = [cookie.name, cookie.path, when(cookie.expires), cookie.secure ? "Secure" : "", cookie.httpOnly ? "HttpOnly" : "", cookie.sameSite].filter(Boolean).join(" · ");
          details.append(line);
        }
        list.append(details);
      }
    };
    const load = async () => {
      status("Reading this profile's cookies…");
      try {
        const answer = await noor.invoke("cookies:list", profile.id);
        sites = answer.sites;
        status(`${answer.count} cookie${answer.count === 1 ? "" : "s"} of ${sites.length} site${sites.length === 1 ? "" : "s"}.`);
      } catch (error) {
        sites = [];
        status(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
      }
      render();
    };
    const act = async (call, said, reload) => {
      try {
        const answer = await call();
        if (answer && answer.canceled) return;
        status(said(answer));
        if (reload) await load();
      } catch (error) {
        status(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
      }
    };
    $("cookies-close").addEventListener("click", () => dialog.close());
    $("cookies-search").addEventListener("input", render);
    $("cookies-export-txt").addEventListener("click", () => act(() => noor.invoke("cookies:export", profile.id, "txt"), (r) => `Exported ${r.count} cookies to ${r.file}.`));
    $("cookies-export-json").addEventListener("click", () => act(() => noor.invoke("cookies:export", profile.id, "json"), (r) => `Exported ${r.count} cookies to ${r.file}.`));
    $("cookies-import").addEventListener("click", () => act(() => noor.invoke("cookies:import", profile.id), (r) => `Imported ${r.count} cookie${r.count === 1 ? "" : "s"}.`, true));
    $("cookies-clear").addEventListener("click", () => {
      ask({ title: `Delete every cookie of ${profile.name}?`, text: "Its sites will sign it out.", ok: "Delete all" }).then((yes) => { if (yes) act(() => noor.invoke("cookies:clear", profile.id), (r) => `Deleted ${r.count} cookie${r.count === 1 ? "" : "s"}.`, true); });
    });
    return {
      show(which) {
        profile = which;
        sites = [];
        $("cookies-title").textContent = `Cookies · ${which.name}`;
        $("cookies-search").value = "";
        render();
        dialog.showModal();
        load();
      },
    };
  })();

  for (const box of document.querySelectorAll("input[data-setting]")) {
    box.addEventListener("change", () => noor.invoke("settings:set", box.dataset.setting, box.checked).then(apply));
  }
  $("add").addEventListener("click", () => {
    noor.invoke("profiles:add", $("newname").value).then((next) => { $("newname").value = ""; apply(next); });
  });
  $("newname").addEventListener("keydown", (event) => { if (event.key === "Enter") $("add").click(); });
  $("addmany").addEventListener("click", () => {
    ask({ title: "Add several profiles", text: "How many new profiles? (up to 50)", value: "5", ok: "Add" }).then((value) => {
      const count = Math.floor(Number(value));
      if (value !== null && count > 0) noor.invoke("profiles:addMany", Math.min(count, 50)).then(apply);
    });
  });
  $("choosechrome").addEventListener("click", () => noor.invoke("chrome:choose").then(apply));
  $("source").addEventListener("click", (event) => { event.preventDefault(); noor.invoke("open:link", event.currentTarget.href); });
  document.addEventListener("click", () => { for (const menu of document.querySelectorAll(".menu.open")) menu.classList.remove("open"); });
  noor.on("state", apply);
  noor.invoke("state").then(apply);
})();
