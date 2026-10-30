"use strict";
// Loads the extension, as zipped for a release, in Chromium (Edge's engine)
// and checks what pages see: noise in Canvas and WebGL (and in audio and
// ClientRects once they are turned on), the same on a site at every visit,
// in its frames, in the windows it opens and in another tab, other values on
// another site, the switches and the sites turned off, and nothing a page
// could tell the protection by. Needs Playwright (npm install -g
// playwright) and a display: on Linux,
//   xvfb-run -a node tools/smoke-extension.js
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");
const { pack } = require("./build-extension");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// What a window sees, as a fingerprinting script reads it.
const READ = `
const hashOf = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16); };
const canvasHash = (win) => {
  const c = win.document.createElement("canvas"); c.width = 220; c.height = 50;
  const x = c.getContext("2d"); x.textBaseline = "top"; x.font = "16px Arial"; x.fillStyle = "#f60"; x.fillRect(100, 1, 62, 20);
  x.fillStyle = "#069"; x.fillText("Noor fingerprint", 2, 15); x.fillStyle = "rgba(102,204,0,0.7)"; x.fillText("Noor fingerprint", 4, 17);
  return hashOf(c.toDataURL());
};
const webglHash = (win) => {
  const c = win.document.createElement("canvas"); c.width = 64; c.height = 64;
  const gl = c.getContext("webgl"); if (!gl) return "no webgl";
  const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "precision mediump float; void main(){gl_FragColor=vec4(gl_FragCoord.x/64.,gl_FragCoord.y/64.,0.5,1.);}"));
  gl.linkProgram(program); gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 0, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "p"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const pixels = new Uint8Array(64 * 64 * 4); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return hashOf(Array.from(pixels).join(","));
};
const audioSum = async (win) => {
  const ctx = new win.OfflineAudioContext(1, 5000, 44100);
  const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor(); osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
  const data = (await ctx.startRendering()).getChannelData(0); let sum = 0; for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]); return String(sum);
};
const rect = (win) => { const r = win.document.getElementById("box").getBoundingClientRect(); return r.width + "x" + r.height; };
const read = async (win) => ({ canvas: canvasHash(win), webgl: webglHash(win), audio: await audioSum(win), rect: rect(win) });
`;
const BOX = `<div id="box" style="width:123.4px;height:10px;font:16px serif">Hello</div>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script>
window.firstLook = { bits: Object.keys(window).filter((k) => /noor/i.test(k)), toDataURL: Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL), own: Function.prototype.toString.call(function () { /* noor lookalike */ }) };
window.violations = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective));
</script></head><body>${BOX}<script>${READ}
(async () => {
  const result = { page: await read(window), firstLook: window.firstLook };
  const blank = document.createElement("iframe"); document.body.appendChild(blank);
  const box = blank.contentDocument.createElement("div");
  box.id = "box"; box.style.cssText = "width:123.4px;height:10px;font:16px serif"; box.textContent = "Hello";
  blank.contentDocument.body.appendChild(box);
  result.blank = await read(blank.contentWindow);
  const frames = {};
  addEventListener("message", (e) => { if (e.data && e.data.name) frames[e.data.name] = e.data.seen; });
  const other = location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  for (const [name, url] of [["frame", "/frame?name=frame"], ["otherSiteFrame", "http://" + other + ":" + location.port + "/frame?name=otherSiteFrame"]]) {
    const f = document.createElement("iframe"); f.src = url; document.body.appendChild(f);
  }
  const popup = window.open("/frame?name=popup", "_blank", "width=320,height=320");
  const until = Date.now() + 8000;
  while (Object.keys(frames).length < 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  Object.assign(result, frames);
  try { popup.close(); } catch (e) {}
  result.violations = window.violations;
  window.result = result;
})();
</script></body></html>`;
const FRAME = `<!doctype html><html><body>${BOX}<script>${READ}
read(window).then((seen) => (window.opener || window.parent).postMessage({ name: new URLSearchParams(location.search).get("name"), seen }, "*"));
</script></body></html>`;

/// The files of a zip the build made: name to contents.
const unzip = (buffer) => {
  const files = {};
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + buffer.readUInt16LE(at + 28);
    files[name] = zlib.inflateRawSync(buffer.subarray(start, start + size));
    at = start + size;
  }
  return files;
};

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

(async () => {
  const zipped = pack("0.0.1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noor-edge-ext-"));
  for (const [name, data] of Object.entries(unzip(fs.readFileSync(zipped)))) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  fs.rmSync(zipped);
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    // A strict policy, as many sites have: the protection must not trip it.
    res.setHeader("content-security-policy", "script-src 'unsafe-inline'; object-src 'none'; require-trusted-types-for 'script'");
    res.end(req.url.startsWith("/frame") ? FRAME : PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "noor-edge-profile-")), {
    headless: false,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  await sleep(1000);
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${id}/popup.html`);
  await popupPage.waitForSelector("#kinds .row");
  const ask = (message) => popupPage.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const visit = async (host) => {
    const page = await context.newPage();
    await page.goto(`http://${host}:${port}/`);
    await page.waitForFunction(() => window.result, null, { timeout: 20000 });
    const result = await page.evaluate(() => window.result);
    await page.close();
    return result;
  };

  // The values a site sees with nothing changed: the site turned off.
  await ask({ type: "setSite", site: "127.0.0.1", on: false });
  const clean = await visit("127.0.0.1");
  await ask({ type: "setSite", site: "127.0.0.1", on: true });

  const first = await visit("127.0.0.1");
  const again = await visit("127.0.0.1");
  const otherSite = await visit("localhost");
  const p = first.page;
  check("Canvas and WebGL get noise", p.canvas !== clean.page.canvas && p.webgl !== clean.page.webgl, { p, clean: clean.page });
  check("audio and ClientRects are left alone at first", p.audio === clean.page.audio && p.rect === clean.page.rect, { p, clean: clean.page });
  check("a site sees the same values at every visit", JSON.stringify(again.page) === JSON.stringify(p), { again: again.page, p });
  check("another site sees other values", otherSite.page.canvas !== p.canvas && otherSite.page.webgl !== p.webgl, otherSite.page);
  for (const name of ["blank", "frame", "otherSiteFrame", "popup"]) {
    check(`the page's ${name} sees the page's values`, first[name] && first[name].canvas === p.canvas && first[name].webgl === p.webgl, first[name]);
  }
  check("built-ins print as the browser's", first.firstLook.toDataURL === "function toDataURL() { [native code] }", first.firstLook);
  check("a page's own function prints as it is", first.firstLook.own === "function () { /* noor lookalike */ }", first.firstLook);
  check("nothing of the extension's is left in the page", first.firstLook.bits.length === 0, first.firstLook);
  check("the page's policy (CSP, Trusted Types) sees no violation", first.violations.length === 0, first.violations);

  await ask({ type: "setEnabled", kind: "audio", on: true });
  await ask({ type: "setEnabled", kind: "clientRects", on: true });
  const all = await visit("127.0.0.1");
  check("audio and ClientRects get noise once on", all.page.audio !== clean.page.audio && all.page.rect !== clean.page.rect, all.page);
  check("and the frames see it too", all.frame.audio === all.page.audio && all.frame.rect === all.page.rect, all.frame);

  await ask({ type: "renew", kinds: ["canvas"] });
  const renewed = await visit("127.0.0.1");
  check("New gives Canvas new values, and WebGL keeps its own", renewed.page.canvas !== all.page.canvas && renewed.page.webgl === all.page.webgl, renewed.page);

  for (const kind of ["canvas", "webGL", "audio", "clientRects"]) await ask({ type: "setEnabled", kind, on: false });
  const registered = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
  const off = await visit("127.0.0.1");
  check("everything off: nothing runs in pages", registered === 0 && JSON.stringify(off.page) === JSON.stringify(clean.page), { registered, off: off.page });

  await context.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("\nEXTENSION SMOKE OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
