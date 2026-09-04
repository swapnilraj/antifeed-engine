export function createCDPClient({ port = process.env.CDP_PORT || 9222 } = {}) {
  const base = `http://localhost:${port}`;

  async function http(path, method = "GET") {
    const response = await fetch(base + path, { method });
    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  // Browser-level commands create background tabs without stealing focus.
  async function browserSend(method, params) {
    const version = await http("/json/version");
    return send(version.webSocketDebuggerUrl, method, params);
  }

  // Page-target commands read or scroll one existing tab.
  async function targetSend(id, method, params, timeoutMs = 15_000) {
    const targets = await http("/json/list");
    const target = targets.find(candidate => candidate.id === id);
    if (!target) {
      console.error(`no tab with id ${id}`);
      process.exit(1);
    }
    return send(target.webSocketDebuggerUrl, method, params, timeoutMs);
  }

  // Keep one target connection alive across several commands. CDP registrations
  // such as Page.addScriptToEvaluateOnNewDocument are scoped to the connection
  // and disappear if a one-shot targetSend socket is closed.
  async function connectTarget(id) {
    const targets = await http("/json/list");
    const target = targets.find(candidate => candidate.id === id);
    if (!target) throw new Error(`no tab with id ${id}`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("websocket error"));
    });
    let nextId = 1;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject, timer, method } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.onerror = () => {
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      }
      pending.clear();
    };
    const sendPersistent = (method, params = {}, timeoutMs = 15_000) => new Promise((resolve, reject) => {
      const messageId = nextId++;
      const timer = setTimeout(() => {
        pending.delete(messageId);
        reject(new Error(`${method}: CDP timeout`));
      }, timeoutMs);
      pending.set(messageId, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
    return {
      send: sendPersistent,
      close: () => socket.close(),
    };
  }

  async function send(webSocketUrl, method, params, timeoutMs = 15_000) {
    const socket = new WebSocket(webSocketUrl);
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP timeout")), timeoutMs);
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
      socket.onmessage = event => {
        const candidate = JSON.parse(event.data);
        if (candidate.id === 1) {
          clearTimeout(timer);
          resolve(candidate);
          socket.close();
        }
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      };
    });
    if (message.error) throw new Error(`${method}: ${message.error.message}`);
    return message.result;
  }

  async function evalInTab(id, expression, timeoutMs = 15_000) {
    const result = await targetSend(id, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }

  return { browserSend, connectTarget, evalInTab, http, targetSend };
}
