// Newline-delimited JSON is every wire in the harness: broker socket, worker
// stdio. `limit` caps the bytes one line may buffer before
// its newline arrives (a pre-auth socket or a worker can otherwise grow the
// host's memory); the caller decides what an error means (destroy, kill).
export function readLines(stream, onMessage, { limit = 1024 * 1024, onError = () => {} } = {}) {
  let buffer = "";
  stream.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > limit) { buffer = ""; return onError(new Error("Oversized message")); }
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(raw); } catch (error) { return onError(error); }
      // Every wire speaks objects; a bare `null` would otherwise throw inside the listener.
      if (message === null || typeof message !== "object") return onError(new Error("Malformed message"));
      onMessage(message);
    }
  });
}

export const sendLine = (stream, message) => stream.write(`${JSON.stringify(message)}\n`);
export const endLine = (stream, message) => stream.end(`${JSON.stringify(message)}\n`);
