// Test-only socket transport for environments that prohibit Unix socket binding.
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";

export function memoryTransport() {
  const listeners = new Map();
  function endpoint() {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.write = data => { queueMicrotask(() => { if (!socket.peer.destroyed) socket.peer.emit("data", Buffer.from(data)); }); return true; };
    socket.destroy = () => {
      for (const end of [socket, socket.peer]) if (!end.destroyed) { end.destroyed = true; queueMicrotask(() => end.emit("close")); }
    };
    socket.end = data => { if (data) socket.write(data); queueMicrotask(() => socket.destroy()); };
    return socket;
  }
  return {
    createServer(handler) {
      const server = new EventEmitter();
      let address;
      server.listen = (path, callback) => { address = path; listeners.set(path, handler); writeFileSync(path, ""); queueMicrotask(callback); };
      server.close = callback => { listeners.delete(address); queueMicrotask(callback); };
      return server;
    },
    connect(path) {
      const client = endpoint();
      const server = endpoint();
      client.peer = server;
      server.peer = client;
      queueMicrotask(() => {
        const handler = listeners.get(path);
        if (!handler) { client.emit("error", new Error("No fixture broker")); client.destroy(); return; }
        handler(server);
        client.emit("connect");
      });
      return client;
    },
  };
}
