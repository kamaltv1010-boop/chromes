"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const { EventEmitter } = require("events");
const { Pipe } = require("../main/cdp");

/// A stand-in for Chrome's process: what it reads on 3, what it writes on 4.
const fakeChrome = () => {
  const child = new EventEmitter();
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  child.stdio = [null, null, null, toChrome, fromChrome];
  const written = [];
  toChrome.on("data", (chunk) => written.push(String(chunk)));
  return { child, fromChrome, written };
};

test("commands are sent as NUL-ended JSON and answered by id", async () => {
  const { child, fromChrome, written } = fakeChrome();
  const pipe = new Pipe(child);
  const answer = pipe.send("Target.setAutoAttach", { autoAttach: true }, "S1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written.join(""), JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true }, sessionId: "S1" }) + "\0");
  fromChrome.write(JSON.stringify({ id: 1, result: { ok: true } }) + "\0");
  assert.deepEqual(await answer, { ok: true });
});

test("an error answer rejects, events are emitted, split messages are joined", async () => {
  const { child, fromChrome } = fakeChrome();
  const pipe = new Pipe(child);
  const events = [];
  pipe.on("event", (event) => events.push(event));
  const failing = pipe.send("Nope.nope");
  const text = JSON.stringify({ id: 1, error: { message: "'Nope.nope' wasn't found" } }) + "\0" + JSON.stringify({ method: "Target.attachedToTarget", params: { sessionId: "W1" }, sessionId: "P1" }) + "\0";
  fromChrome.write(text.slice(0, 20));
  fromChrome.write(text.slice(20));
  await assert.rejects(failing, /wasn't found/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ method: "Target.attachedToTarget", params: { sessionId: "W1" }, sessionId: "P1" }]);
});

test("Chrome closing rejects what is pending and refuses more", async () => {
  const { child, fromChrome } = fakeChrome();
  const pipe = new Pipe(child);
  const pending = pipe.send("Browser.getVersion");
  const closed = new Promise((resolve) => pipe.once("close", resolve));
  fromChrome.end();
  await closed;
  await assert.rejects(pending, /closed/);
  await assert.rejects(pipe.send("Browser.getVersion"), /closed/);
});
