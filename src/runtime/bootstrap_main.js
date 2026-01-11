// Import Deno WebIDL
import * as webidl from "ext:deno_webidl/00_webidl.js";

// Import all Deno web extension modules
import * as infra from "ext:deno_web/00_infra.js";
import * as url from "ext:deno_web/00_url.js";
import * as console from "ext:deno_web/01_console.js";
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
import * as location from "ext:deno_web/12_location.js";
import * as messagePort from "ext:deno_web/13_message_port.js";
import * as compression from "ext:deno_web/14_compression.js";
import * as performance from "ext:deno_web/15_performance.js";
import * as imageData from "ext:deno_web/16_image_data.js";

import * as denoNet from "ext:deno_net/01_net.js";
import * as denoTls from "ext:deno_net/02_tls.js";

import * as crypto from "ext:deno_crypto/00_crypto.js";

// Import Deno I/O APIs
import * as io from "ext:deno_io/12_io.js";

// Import Deno filesystem APIs
import * as fs from "ext:deno_fs/30_fs.js";

// Import Deno OS APIs
import * as os from "ext:deno_os/30_os.js";

// Import Deno WebSocket APIs
import * as webSocket from "ext:deno_websocket/01_websocket.js";
import * as websocketStream from "ext:deno_websocket/02_websocketstream.js";

// Import Deno fetch APIs
import * as headers from "ext:deno_fetch/20_headers.js";
import * as formData from "ext:deno_fetch/21_formdata.js";
import * as request from "ext:deno_fetch/23_request.js";
import * as response from "ext:deno_fetch/23_response.js";
import * as fetch from "ext:deno_fetch/26_fetch.js";
import * as eventSource from "ext:deno_fetch/27_eventsource.js";

import "ext:privileged_ops/bootstrap.js";

// Define all global properties with their respective configurations
const globalProperties = [
  // Abort APIs
  { name: "AbortController", value: abortSignal.AbortController, enumerable: false, configurable: true, writable: true },
  { name: "AbortSignal", value: abortSignal.AbortSignal, enumerable: false, configurable: true, writable: true },
  
  // File APIs
  { name: "Blob", value: file.Blob, enumerable: false, configurable: true, writable: true },
  { name: "File", value: file.File, enumerable: false, configurable: true, writable: true },
  { name: "FileReader", value: fileReader.FileReader, enumerable: false, configurable: true, writable: true },
  
  // Stream APIs
  { name: "ByteLengthQueuingStrategy", value: streams.ByteLengthQueuingStrategy, enumerable: false, configurable: true, writable: true },
  { name: "CountQueuingStrategy", value: streams.CountQueuingStrategy, enumerable: false, configurable: true, writable: true },
  { name: "ReadableStream", value: streams.ReadableStream, enumerable: false, configurable: true, writable: true },
  { name: "ReadableStreamDefaultReader", value: streams.ReadableStreamDefaultReader, enumerable: false, configurable: true, writable: true },
  { name: "ReadableByteStreamController", value: streams.ReadableByteStreamController, enumerable: false, configurable: true, writable: true },
  { name: "ReadableStreamBYOBReader", value: streams.ReadableStreamBYOBReader, enumerable: false, configurable: true, writable: true },
  { name: "ReadableStreamBYOBRequest", value: streams.ReadableStreamBYOBRequest, enumerable: false, configurable: true, writable: true },
  { name: "ReadableStreamDefaultController", value: streams.ReadableStreamDefaultController, enumerable: false, configurable: true, writable: true },
  { name: "WritableStream", value: streams.WritableStream, enumerable: false, configurable: true, writable: true },
  { name: "WritableStreamDefaultWriter", value: streams.WritableStreamDefaultWriter, enumerable: false, configurable: true, writable: true },
  { name: "WritableStreamDefaultController", value: streams.WritableStreamDefaultController, enumerable: false, configurable: true, writable: true },
  { name: "TransformStream", value: streams.TransformStream, enumerable: false, configurable: true, writable: true },
  { name: "TransformStreamDefaultController", value: streams.TransformStreamDefaultController, enumerable: false, configurable: true, writable: true },
  
  // Compression APIs
  { name: "CompressionStream", value: compression.CompressionStream, enumerable: false, configurable: true, writable: true },
  { name: "DecompressionStream", value: compression.DecompressionStream, enumerable: false, configurable: true, writable: true },
  
  // Event APIs
  { name: "CloseEvent", value: event.CloseEvent, enumerable: false, configurable: true, writable: true },
  { name: "CustomEvent", value: event.CustomEvent, enumerable: false, configurable: true, writable: true },
  { name: "ErrorEvent", value: event.ErrorEvent, enumerable: false, configurable: true, writable: true },
  { name: "Event", value: event.Event, enumerable: false, configurable: true, writable: true },
  { name: "EventTarget", value: event.EventTarget, enumerable: false, configurable: true, writable: true },
  { name: "MessageEvent", value: event.MessageEvent, enumerable: false, configurable: true, writable: true },
  { name: "PromiseRejectionEvent", value: event.PromiseRejectionEvent, enumerable: false, configurable: true, writable: true },
  { name: "ProgressEvent", value: event.ProgressEvent, enumerable: false, configurable: true, writable: true },
  
  // Exception
  { name: "DOMException", value: DOMException.DOMException, enumerable: false, configurable: true, writable: true },
  
  // Text Encoding APIs
  { name: "TextDecoder", value: encoding.TextDecoder, enumerable: false, configurable: true, writable: true },
  { name: "TextEncoder", value: encoding.TextEncoder, enumerable: false, configurable: true, writable: true },
  { name: "TextDecoderStream", value: encoding.TextDecoderStream, enumerable: false, configurable: true, writable: true },
  { name: "TextEncoderStream", value: encoding.TextEncoderStream, enumerable: false, configurable: true, writable: true },
  
  // Message Channel APIs
  { name: "MessageChannel", value: messagePort.MessageChannel, enumerable: false, configurable: true, writable: true },
  { name: "MessagePort", value: messagePort.MessagePort, enumerable: false, configurable: true, writable: true },
  
  // Performance APIs
  { name: "Performance", value: performance.Performance, enumerable: false, configurable: true, writable: true },
  { name: "PerformanceEntry", value: performance.PerformanceEntry, enumerable: false, configurable: true, writable: true },
  { name: "PerformanceMark", value: performance.PerformanceMark, enumerable: false, configurable: true, writable: true },
  { name: "PerformanceMeasure", value: performance.PerformanceMeasure, enumerable: false, configurable: true, writable: true },
  
  // Image Data
  { name: "ImageData", value: imageData.ImageData, enumerable: false, configurable: true, writable: true },
  
  // URL APIs
  { name: "URL", value: url.URL, enumerable: false, configurable: true, writable: true },
  { name: "URLSearchParams", value: url.URLSearchParams, enumerable: false, configurable: true, writable: true },
  { name: "URLPattern", value: urlPattern.URLPattern, enumerable: false, configurable: true, writable: true },
  
  // Broadcast Channel
  { name: "BroadcastChannel", value: broadcastChannel.BroadcastChannel, enumerable: false, configurable: true, writable: true },
  
  // Crypto APIs
  { name: "CryptoKey", value: crypto.CryptoKey, enumerable: false, configurable: true, writable: true },
  { name: "Crypto", value: crypto.Crypto, enumerable: false, configurable: true, writable: true },
  { name: "SubtleCrypto", value: crypto.SubtleCrypto, enumerable: false, configurable: true, writable: true },
  { name: "atob", value: base64.atob, enumerable: true, configurable: true, writable: true },
  { name: "btoa", value: base64.btoa, enumerable: true, configurable: true, writable: true },
  { name: "clearInterval", value: timers.clearInterval, enumerable: true, configurable: true, writable: true },
  { name: "clearTimeout", value: timers.clearTimeout, enumerable: true, configurable: true, writable: true },
  { name: "performance", value: performance.performance, enumerable: true, configurable: true, writable: true },
  { name: "reportError", value: event.reportError, enumerable: true, configurable: true, writable: true },
  { name: "setInterval", value: timers.setInterval, enumerable: true, configurable: true, writable: true },
  { name: "setTimeout", value: timers.setTimeout, enumerable: true, configurable: true, writable: true },
  { name: "structuredClone", value: messagePort.structuredClone, enumerable: true, configurable: true, writable: true },
  { name: "crypto", value: crypto.crypto, enumerable: false, configurable: true, writable: false },

  // Fetch APIs
  { name: "Headers", value: headers.Headers, enumerable: false, configurable: true, writable: true },
  { name: "FormData", value: formData.FormData, enumerable: false, configurable: true, writable: true },
  { name: "Request", value: request.Request, enumerable: false, configurable: true, writable: true },
  { name: "Response", value: response.Response, enumerable: false, configurable: true, writable: true },
  { name: "fetch", value: fetch.fetch, enumerable: true, configurable: true, writable: true },
  { name: "EventSource", value: eventSource.EventSource, enumerable: false, configurable: true, writable: true },

  // WebSocket APIs
  { name: "WebSocket", value: webSocket.WebSocket, enumerable: false, configurable: true, writable: true },
];

for (const prop of globalProperties) {
  Object.defineProperty(globalThis, prop.name, {
    value: prop.value,
    enumerable: prop.enumerable,
    configurable: prop.configurable,
    writable: prop.writable,
  });
}

// discord.js expects to be capable of serializing BitInt
BigInt.prototype.toJSON = function () {
    return { $bigint: this.toString() };
};

// V8Sandbox communication API
const core = Deno.core;

// Extend Deno namespace with fs, io, net, and OS APIs
Object.assign(Deno, fs, io, denoNet, denoTls, os);

// Add version info
Deno.version = {
  deno: "custom",
  v8: "12.9.202.13-rusty",
  typescript: "5.7.2"
};
globalThis.__v8SandboxHandlers = {};

globalThis.v8Sandbox = {
  on(channel, handler) {
    if (!globalThis.__v8SandboxHandlers[channel]) {
      globalThis.__v8SandboxHandlers[channel] = [];
    }
    globalThis.__v8SandboxHandlers[channel].push(handler);
    // Register with Rust
    core.ops.op_v8_sandbox_on(channel);
  },
  
  async send(channel, data) {
    await core.ops.op_v8_sandbox_send(channel, data);
  }
};

// Dispatch messages from host to sandbox
globalThis.__v8SandboxDispatch = async function __v8SandboxDispatch(channel, data) {
  const handlers = globalThis.__v8SandboxHandlers[channel] || [];
  for (const handler of handlers) {
    await handler(data);
  }
};