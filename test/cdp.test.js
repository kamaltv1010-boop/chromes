"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { Connection } = require("../main/cdp");
const { ChromeInstance, browserAddress, freePort } = require("../main/chrome");

/// A stand-in for Chrome's WebSocket: what is sent to Chrome, and a way to
/// answer as Chrome.
class FakeSocket extends EventTarget {
  constructor() {
    super();
    this.sent = [];
  }

  send(text) {
    this.sent.push(text);
  }

  close() {
    this.dispatchEvent(new Event("close"));
  }

  fromChrome(message) {
    const event = new Event("message");
    event.data = JSON.stringify(message);
    this.dispatchEvent(event);
  }
}

test("commands are sent as JSON and answered by id", async () => {
  const socket = new FakeSocket();
  const connection = new Connection(socket);
  const answer = connection.send("Target.setAutoAttach", { autoAttach: true }, "S1");
  assert.deepEqual(socket.sent.map((text) => JSON.parse(text)), [{ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true }, sessionId: "S1" }]);
  socket.fromChrome({ id: 1, result: { ok: true } });
  assert.deepEqual(await answer, { ok: true });
});

test("an error answer rejects, and events are emitted", async () => {
  const socket = new FakeSocket();
  const connection = new Connection(socket);
  const events = [];
  connection.on("event", (event) => events.push(event));
  const failing = connection.send("Nope.nope");
  socket.fromChrome({ id: 1, error: { message: "'Nope.nope' wasn't found" } });
  socket.fromChrome({ method: "Target.attachedToTarget", params: { sessionId: "W1" }, sessionId: "P1" });
  await assert.rejects(failing, /wasn't found/);
  assert.deepEqual(events, [{ method: "Target.attachedToTarget", params: { sessionId: "W1" }, sessionId: "P1" }]);
});

test("Chrome closing rejects what is pending and refuses more", async () => {
  const socket = new FakeSocket();
  const connection = new Connection(socket);
  const pending = connection.send("Browser.getVersion");
  const closed = new Promise((resolve) => connection.once("close", resolve));
  socket.close();
  await closed;
  await assert.rejects(pending, /closed/);
  await assert.rejects(connection.send("Browser.getVersion"), /closed/);
});

test("the connection opens once the socket does, and fails if it can't", async () => {
  class Opening extends FakeSocket {
    constructor(url) {
      super();
      this.url = url;
      setImmediate(() => this.dispatchEvent(new Event(url.includes("bad") ? "error" : "open")));
    }
  }
  const connection = await Connection.open("ws://127.0.0.1:1/devtools/browser/x", Opening);
  assert.equal(connection.socket.url, "ws://127.0.0.1:1/devtools/browser/x");
  await assert.rejects(Connection.open("ws://127.0.0.1:1/bad", Opening), /Couldn't connect/);
});

test("Chrome's address is taken only from its own answer on its port", () => {
  const answer = (address) => JSON.stringify({ Browser: "Chrome/142.0.0.0", webSocketDebuggerUrl: address });
  assert.equal(browserAddress(answer("ws://127.0.0.1:9333/devtools/browser/0b4c-77"), 9333), "ws://127.0.0.1:9333/devtools/browser/0b4c-77");
  assert.equal(browserAddress(answer("ws://127.0.0.1:9334/devtools/browser/0b4c-77"), 9333), null);
  assert.equal(browserAddress(answer("ws://evil.example:9333/devtools/browser/0b4c-77"), 9333), null);
  assert.equal(browserAddress(answer("ws://127.0.0.1:9333/devtools/page/0b4c-77"), 9333), null);
  assert.equal(browserAddress("<html>not chrome</html>", 9333), null);
  assert.equal(browserAddress(null, 9333), null);
});

test("a free port is one nothing listens on", async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  server.close();
});

test("Chrome is opened with nothing it warns about or marks as automated", () => {
  const instance = new ChromeInstance({ executable: "chrome", profile: { id: "p", proxy: "socks5://127.0.0.1:1080" }, dir: "/tmp/p", pageScript: "", workerScript: () => null });
  instance.port = 9333;
  const args = instance.args();
  assert.ok(args.includes("--remote-debugging-port=9333") && args.includes("--user-data-dir=/tmp/p") && args.includes("--proxy-server=socks5://127.0.0.1:1080"));
  assert.ok(!args.some((arg) => /^--(remote-debugging-pipe|disable-blink-features|enable-automation|remote-debugging-port=0$)/.test(arg)));
});
