// Bootstrap for worker isolates
// Includes web APIs (timers, crypto, etc.) but NO network access
// NOTE: console is stubbed - implement via NETWORK.send() if needed

// Import WebIDL
import * as webidl from "ext:deno_webidl/00_webidl.js";

// Import Deno web extension modules (NO network modules)
import * as infra from "ext:deno_web/00_infra.js";
import * as url from "ext:deno_web/00_url.js";
// Console is imported for internal error handling only, not exposed globally
import * as internalConsole from "ext:deno_web/01_console.js";
import * as DOMException from "ext:deno_web/01_dom_exception.js";
import * as mimesniff from "ext:deno_web/01_mimesniff.js";
import * as urlPattern from "ext:deno_web/01_urlpattern.js";
import * as broadcastChannel from "ext:deno_web/01_broadcast_channel.js";
import * as event from "ext:deno_web/02_event.js";
import * as structuredClone from "ext:deno_web/02_structured_clone.js";
import * as timers from "ext:deno_web/02_timers.js";
import * as abortSignal from "ext:deno_web/03_abort_signal.js";
import * as globalInterfaces from "ext:deno_web/04_global_interfaces.js";
import * as base64 from "ext:deno_web/05_base64.js";
import * as streams from "ext:deno_web/06_streams.js";
import * as encoding from "ext:deno_web/08_text_encoding.js";
import * as file from "ext:deno_web/09_file.js";
import * as fileReader from "ext:deno_web/10_filereader.js";
import * as location from "ext:deno_web/12_location.js"; // Import but don't expose
import * as messagePort from "ext:deno_web/13_message_port.js";
import * as compression from "ext:deno_web/14_compression.js";
import * as performance from "ext:deno_web/15_performance.js";
import * as imageData from "ext:deno_web/16_image_data.js";

// Import crypto APIs (non-network)
import * as crypto from "ext:deno_crypto/00_crypto.js";

const core = globalThis.Deno.core;
const ops = core.ops;

// Event handlers for messages from main
const eventHandlers = new Map();

// Pending requests for async request/response
const pendingRequests = new Map();
let nextRequestId = 0;

/**
 * Register an event handler for messages from main isolate
 * @param {string} event - The event name
 * @param {Function} handler - The event handler function
 */
function on(event, handler) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, []);
  }
  eventHandlers.get(event).push(handler);
}

/**
 * Remove an event handler
 * @param {string} event - The event name
 * @param {Function} handler - The handler to remove
 */
function off(event, handler) {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }
}

/**
 * Send a message to the main isolate (fire-and-forget)
 * @param {string} event - The event name
 * @param {*} data - The data to send (must be JSON-serializable)
 */
function send(event, data) {
  ops.op_worker_send(event, data);
}

/**
 * Send a request to the main isolate and wait for a response
 * @param {string} method - The method/action name
 * @param {*} data - The data to send (must be JSON-serializable)
 * @returns {Promise<*>} The response data
 */
function request(method, data) {
  const requestId = nextRequestId++;

  return new Promise((resolve, reject) => {
    // Store resolver (no timeout - waits indefinitely)
    pendingRequests.set(requestId, { resolve, reject });

    // Send request with ID
    ops.op_worker_send('__request', {
      requestId,
      method,
      data,
    });
  });
}

/**
 * Dispatch an event to registered handlers
 * Called internally when main sends a message
 * @private
 */
function __dispatchEvent(event, data) {
  // Check if this is a response to a pending request
  if (event === '__response') {
    const { requestId, error, result } = data;
    const pending = pendingRequests.get(requestId);

    if (pending) {
      pendingRequests.delete(requestId);

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
    return;
  }

  // Normal event handling
  const handlers = eventHandlers.get(event);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        // Use internal console for error reporting (not exposed to user code)
        internalConsole.Console.prototype.error.call(
          internalConsole.console,
          `Error in event handler for '${event}':`,
          e
        );
      }
    }
  }
}

// Expose messaging API under NETWORK global
globalThis.NETWORK = {
  on,
  off,
  send,
  request,
  __dispatchEvent,
};

// Define all global web APIs (but NO network APIs)
const globalProperties = [
  // Abort APIs
  { name: "AbortController", value: abortSignal.AbortController },
  { name: "AbortSignal", value: abortSignal.AbortSignal },

  // File APIs
  { name: "Blob", value: file.Blob },
  { name: "File", value: file.File },
  { name: "FileReader", value: fileReader.FileReader },

  // Stream APIs
  { name: "ByteLengthQueuingStrategy", value: streams.ByteLengthQueuingStrategy },
  { name: "CountQueuingStrategy", value: streams.CountQueuingStrategy },
  { name: "ReadableStream", value: streams.ReadableStream },
  { name: "ReadableStreamDefaultReader", value: streams.ReadableStreamDefaultReader },
  { name: "ReadableByteStreamController", value: streams.ReadableByteStreamController },
  { name: "ReadableStreamBYOBReader", value: streams.ReadableStreamBYOBReader },
  { name: "ReadableStreamBYOBRequest", value: streams.ReadableStreamBYOBRequest },
  { name: "ReadableStreamDefaultController", value: streams.ReadableStreamDefaultController },
  { name: "WritableStream", value: streams.WritableStream },
  { name: "WritableStreamDefaultWriter", value: streams.WritableStreamDefaultWriter },
  { name: "WritableStreamDefaultController", value: streams.WritableStreamDefaultController },
  { name: "TransformStream", value: streams.TransformStream },
  { name: "TransformStreamDefaultController", value: streams.TransformStreamDefaultController },

  // Compression APIs
  { name: "CompressionStream", value: compression.CompressionStream },
  { name: "DecompressionStream", value: compression.DecompressionStream },

  // Event APIs
  { name: "CloseEvent", value: event.CloseEvent },
  { name: "CustomEvent", value: event.CustomEvent },
  { name: "ErrorEvent", value: event.ErrorEvent },
  { name: "Event", value: event.Event },
  { name: "EventTarget", value: event.EventTarget },
  { name: "MessageEvent", value: event.MessageEvent },
  { name: "PromiseRejectionEvent", value: event.PromiseRejectionEvent },
  { name: "ProgressEvent", value: event.ProgressEvent },

  // Exception
  { name: "DOMException", value: DOMException.DOMException },

  // Text Encoding APIs
  { name: "TextDecoder", value: encoding.TextDecoder },
  { name: "TextEncoder", value: encoding.TextEncoder },
  { name: "TextDecoderStream", value: encoding.TextDecoderStream },
  { name: "TextEncoderStream", value: encoding.TextEncoderStream },

  // Message Channel APIs
  { name: "MessageChannel", value: messagePort.MessageChannel },
  { name: "MessagePort", value: messagePort.MessagePort },

  // Performance APIs
  { name: "Performance", value: performance.Performance },
  { name: "PerformanceEntry", value: performance.PerformanceEntry },
  { name: "PerformanceMark", value: performance.PerformanceMark },
  { name: "PerformanceMeasure", value: performance.PerformanceMeasure },

  // Image Data
  { name: "ImageData", value: imageData.ImageData },

  // URL APIs
  { name: "URL", value: url.URL },
  { name: "URLSearchParams", value: url.URLSearchParams },
  { name: "URLPattern", value: urlPattern.URLPattern },

  // Broadcast Channel
  { name: "BroadcastChannel", value: broadcastChannel.BroadcastChannel },

  // Crypto APIs
  { name: "CryptoKey", value: crypto.CryptoKey },
  { name: "Crypto", value: crypto.Crypto },
  { name: "SubtleCrypto", value: crypto.SubtleCrypto },
  { name: "crypto", value: crypto.crypto },

  // Utility functions
  { name: "atob", value: base64.atob },
  { name: "btoa", value: base64.btoa },
  { name: "clearInterval", value: timers.clearInterval },
  { name: "clearTimeout", value: timers.clearTimeout },
  { name: "setInterval", value: timers.setInterval },
  { name: "setTimeout", value: timers.setTimeout },
  { name: "performance", value: performance.performance },
  { name: "reportError", value: event.reportError },
  { name: "structuredClone", value: messagePort.structuredClone },
];

for (const prop of globalProperties) {
  Object.defineProperty(globalThis, prop.name, {
    value: prop.value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

// Stub console - workers should implement console via NETWORK.send() if needed
// This prevents workers from spamming the host console
const noop = () => {};
globalThis.console = {
  log: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  dir: noop,
  dirxml: noop,
  table: noop,
  group: noop,
  groupCollapsed: noop,
  groupEnd: noop,
  clear: noop,
  count: noop,
  countReset: noop,
  assert: noop,
  time: noop,
  timeLog: noop,
  timeEnd: noop,
};

// Global WebSocket registry
const webSocketRegistry = new Map();

// WebSocket implementation using channels (defined after EventTarget is available)
class WorkerWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  #connId = null;
  #readyState = 0; // CONNECTING
  #url = '';

  constructor(url) {
    super();

    this.#url = String(url);

    // Open connection and get connection ID
    this.#connId = ops.op_worker_websocket_open(this.#url);

    // Register this WebSocket instance
    webSocketRegistry.set(this.#connId, this);
  }

  _handleOpen() {
    this.#readyState = WorkerWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  _handleMessage(data) {
    if (this.#readyState === WorkerWebSocket.OPEN) {
      this.dispatchEvent(new MessageEvent('message', { data }));
    }
  }

  _handleClose(code, reason) {
    this.#readyState = WorkerWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
    // Cleanup: remove from registry
    webSocketRegistry.delete(this.#connId);
  }

  _handleError(message) {
    this.dispatchEvent(new ErrorEvent('error', { message }));
  }

  send(data) {
    if (this.#readyState !== WorkerWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    ops.op_worker_websocket_send(this.#connId, String(data));
  }

  close(code = 1000, reason = '') {
    if (this.#readyState >= WorkerWebSocket.CLOSING) {
      return;
    }
    this.#readyState = WorkerWebSocket.CLOSING;
    ops.op_worker_websocket_close(this.#connId);
  }

  get readyState() {
    return this.#readyState;
  }

  get url() {
    return this.#url;
  }
}

// Single global WebSocket event dispatcher
NETWORK.on('__ws_event', ({ conn_id, event_type, data }) => {
  const ws = webSocketRegistry.get(conn_id);
  if (!ws) return;

  switch (event_type) {
    case 'open':
      ws._handleOpen();
      break;
    case 'message':
      ws._handleMessage(data);
      break;
    case 'close':
      ws._handleClose(data?.code || 1000, data?.reason || '');
      break;
    case 'error':
      ws._handleError(data?.message || 'WebSocket error');
      break;
  }
});

// Expose WebSocket globally
globalThis.WebSocket = WorkerWebSocket;

// Headers polyfill for fetch API compatibility
class Headers {
  #headers = new Map();

  constructor(init) {
    if (init) {
      if (init instanceof Headers) {
        init.forEach((value, key) => this.append(key, value));
      } else if (Array.isArray(init)) {
        for (const [key, value] of init) {
          this.append(key, value);
        }
      } else if (typeof init === 'object') {
        for (const [key, value] of Object.entries(init)) {
          this.append(key, value);
        }
      }
    }
  }

  append(name, value) {
    const normalizedName = String(name).toLowerCase();
    const normalizedValue = String(value);

    if (this.#headers.has(normalizedName)) {
      const existing = this.#headers.get(normalizedName);
      this.#headers.set(normalizedName, `${existing}, ${normalizedValue}`);
    } else {
      this.#headers.set(normalizedName, normalizedValue);
    }
  }

  delete(name) {
    this.#headers.delete(String(name).toLowerCase());
  }

  get(name) {
    return this.#headers.get(String(name).toLowerCase()) ?? null;
  }

  has(name) {
    return this.#headers.has(String(name).toLowerCase());
  }

  set(name, value) {
    this.#headers.set(String(name).toLowerCase(), String(value));
  }

  forEach(callback, thisArg) {
    for (const [key, value] of this.#headers) {
      callback.call(thisArg, value, key, this);
    }
  }

  *keys() {
    yield* this.#headers.keys();
  }

  *values() {
    yield* this.#headers.values();
  }

  *entries() {
    yield* this.#headers.entries();
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

globalThis.Headers = Headers;

// Implement fetch API - validation is handled by host
globalThis.fetch = async function fetch(url, options = {}) {
  // Convert URL to string if it's a URL object
  const urlString = url instanceof URL ? url.href : String(url);

  // Send fetch request to host (host decides if URL is allowed)
  const response = await NETWORK.request('fetch', {
    url: urlString,
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
  });

  // Return a Response-like object
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText || '',
    headers: new Headers(response.headers || {}),

    async json() {
      if (typeof response.body === 'string') {
        return JSON.parse(response.body);
      }
      return response.body;
    },

    async text() {
      return String(response.body || '');
    },

    async arrayBuffer() {
      const text = String(response.body || '');
      const encoder = new TextEncoder();
      return encoder.encode(text).buffer;
    },

    async blob() {
      const buffer = await this.arrayBuffer();
      return new Blob([buffer]);
    },
  };
};
