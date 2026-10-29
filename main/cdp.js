"use strict";
const { EventEmitter } = require("events");

/// A client of Chrome's debugging protocol over the pipe Chrome opens with
/// --remote-debugging-pipe: messages are JSON, each ended by a NUL byte,
/// written to Chrome's file descriptor 3 and read from its 4. Nothing of
/// it is on the network. `send` gives a promise of the result; events come
/// as "event" with { method, params, sessionId }.
class Pipe extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.writer = child.stdio[3];
    this.reader = child.stdio[4];
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    let buffered = "";
    this.reader.setEncoding("utf8");
    this.reader.on("data", (chunk) => {
      buffered += chunk;
      let end;
      while ((end = buffered.indexOf("\0")) !== -1) {
        const text = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        this.receive(text);
      }
    });
    const close = () => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error("Chrome closed"));
      }
      this.pending.clear();
      this.emit("close");
    };
    this.reader.on("end", close);
    this.reader.on("close", close);
    this.reader.on("error", close);
    child.on("exit", close);
  }

  receive(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "Protocol error"));
      } else {
        resolve(message.result || {});
      }
      return;
    }
    if (message.method) {
      this.emit("event", { method: message.method, params: message.params || {}, sessionId: message.sessionId });
    }
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed) {
      return Promise.reject(new Error("Chrome closed"));
    }
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) {
      message.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.writer.write(JSON.stringify(message) + "\0");
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

module.exports = { Pipe };
