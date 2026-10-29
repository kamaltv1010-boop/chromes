// Chrome: pages see Google Chrome's brands in navigator.userAgentData, as
// the user agent and the request headers say, not Chromium's own.
{
  const data = window.navigator.userAgentData;
  const chrome = config.chrome;
  if (data && chrome && chrome.brands) {
    const proto = getPrototypeOf(data);
    const copy = (list) => list.map((b) => ({ brand: b.brand, version: b.version }));
    defineGetter(proto, "brands", () => copy(chrome.brands));
    define(proto, "getHighEntropyValues", (original) => function (hints) {
      return original.call(this, hints).then((values) => {
        if ("brands" in values) values.brands = copy(chrome.brands);
        if ("fullVersionList" in values && chrome.fullVersionList) values.fullVersionList = copy(chrome.fullVersionList);
        if ("uaFullVersion" in values && chrome.fullVersion) values.uaFullVersion = chrome.fullVersion;
        return values;
      });
    });
    define(proto, "toJSON", (original) => function () {
      const values = original.call(this);
      values.brands = copy(chrome.brands);
      return values;
    });
  }
}

// Chrome's own object: chrome.app, chrome.csi() and chrome.loadTimes(),
// which Chromium without Chrome's parts leaves empty.
{
  const chromeObject = window.chrome;
  if (chromeObject && typeof chromeObject === "object" && !("app" in chromeObject)) {
    const timing = () => (window.performance && window.performance.timing) || null;
    const seconds = (value) => (value ? value / 1000 : 0);
    const add = (name, value) => defineProperty(chromeObject, name, { value, writable: true, enumerable: true, configurable: true });
    add("loadTimes", method("loadTimes", 0, () => {
      const t = timing() || {};
      return {
        requestTime: seconds(t.navigationStart),
        startLoadTime: seconds(t.fetchStart),
        commitLoadTime: seconds(t.responseStart),
        finishDocumentLoadTime: seconds(t.domContentLoadedEventEnd),
        finishLoadTime: seconds(t.loadEventEnd),
        firstPaintTime: seconds(t.responseStart) + 0.05,
        firstPaintAfterLoadTime: 0,
        navigationType: "Other",
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: "h2",
        wasAlternateProtocolAvailable: false,
        connectionInfo: "h2",
      };
    }));
    add("csi", method("csi", 0, () => {
      const t = timing();
      const at = now();
      return {
        startE: t ? t.navigationStart : at,
        onloadT: t ? t.domContentLoadedEventEnd : at,
        pageT: t ? at - t.navigationStart + 0.123 : 0,
        tran: 15,
      };
    }));
    add("app", {
      isInstalled: false,
      InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
      RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      getDetails: method("getDetails", 0, () => null),
      getIsInstalled: method("getIsInstalled", 0, () => false),
      installState: method("installState", 0, function (callback) {
        if (typeof callback === "function") callback("not_installed");
      }),
      runningState: method("runningState", 0, () => "cannot_run"),
    });
  }
}

// Notifications: pages see the permission as not asked yet, as in a fresh
// Chrome (the app refuses them, which pages would see as a user who said
// no to every site), and asking leaves it so.
{
  const Notification = window.Notification;
  if (Notification) {
    defineGetter(Notification, "permission", () => "default");
    define(Notification, "requestPermission", (original) => function (callback) {
      if (typeof callback === "function") {
        try { callback("default"); } catch (e) {}
      }
      return window.Promise.resolve("default");
    });
  }
  const status = window.PermissionStatus && window.PermissionStatus.prototype;
  if (status) {
    defineGetter(status, "state", function (value) {
      return this.name === "notifications" ? "prompt" : value;
    });
  }
}

// Web Share, which Chrome on Windows has: nothing here to share with, so a
// share is refused as a user who closed the dialog.
{
  const proto = window.Navigator && window.Navigator.prototype;
  if (proto && !("share" in proto) && window.DOMException) {
    const checkThis = (self) => {
      if (!(self instanceof window.Navigator)) throw new window.TypeError("Illegal invocation");
    };
    const shareable = (data) => Boolean(data && typeof data === "object" && (
      typeof data.title === "string" || typeof data.text === "string" || data.url !== undefined || (data.files && data.files.length)));
    const add = (name, fn) => defineProperty(proto, name, { value: fn, writable: true, enumerable: true, configurable: true });
    add("canShare", method("canShare", 0, function (data) {
      checkThis(this);
      if (!shareable(data)) return false;
      if (data.url !== undefined) {
        try { new window.URL(String(data.url), window.location.href); } catch (e) { return false; }
      }
      return true;
    }));
    add("share", method("share", 0, function (data) {
      checkThis(this);
      if (!shareable(data)) {
        return window.Promise.reject(new window.TypeError("Failed to execute 'share' on 'Navigator': Must specify at least one of title, text, url, or files"));
      }
      const active = window.navigator.userActivation && window.navigator.userActivation.isActive;
      if (!active) {
        return window.Promise.reject(new window.DOMException("Failed to execute 'share' on 'Navigator': Must be handling a user gesture to perform a share request.", "NotAllowedError"));
      }
      return window.Promise.reject(new window.DOMException("Share canceled", "AbortError"));
    }));
  }
}
