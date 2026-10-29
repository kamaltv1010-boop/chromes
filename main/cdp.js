"use strict";
const { EventEmitter } = require("events");

/// A client of Chrome's debugging protocol, over the WebSocket of the
/// debugging port Chrome was given (only this computer can reach it).
/// Messages are JSON; `send` gives a promise of the result, and events
/// come as "event" with { method, params, sessionId }. `socket` is a
/// WebSocket, open (see Connection.open).
class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
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
    socket.addEventListener("close", close);
    socket.addEventListener("error", close);
  }

  /// Connects to `url` (Chrome's browser address, ws://127.0.0.1:…).
  static open(url, Socket = globalThis.WebSocket) {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new Socket(url);
      } catch (error) {
        reject(error);
        return;
      }
      const failed = () => reject(new Error("Couldn't connect to Chrome"));
      socket.addEventListener("error", failed);
      socket.addEventListener("open", () => {
        socket.removeEventListener("error", failed);
        resolve(new Connection(socket));
      });
    });
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
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    try {
      this.socket.close();
    } catch (error) {
      // Gone already.
    }
  }
}

module.exports = { Connection };
