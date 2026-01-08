/**
 * TypeScript declarations for Worker/Sandbox environment
 *
 * Workers are isolated JavaScript execution contexts with:
 * - Web APIs (timers, crypto, streams, etc.)
 * - Console is STUBBED (implement via NETWORK.send() if needed)
 * - NO filesystem access
 * - NO direct network access (must go through host via NETWORK.request)
 * - Communication with host via NETWORK global
 */

// ============================================================================
// NETWORK API - Communication with host
// ============================================================================

declare global {
  /**
   * NETWORK global - Communication API for workers to interact with the host
   */
  const NETWORK: {
    /**
     * Register an event handler for messages from the host
     * @param event - The event name
     * @param handler - Callback invoked when the event is received
     */
    on(event: string, handler: (data: any) => void): void;

    /**
     * Remove an event handler
     * @param event - The event name
     * @param handler - The handler to remove
     */
    off(event: string, handler: (data: any) => void): void;

    /**
     * Send a one-way message to the host (fire-and-forget)
     * @param event - The event name
     * @param data - Data to send (must be JSON-serializable)
     */
    send(event: string, data: any): void;

    /**
     * Send a request to the host and wait for a response
     * Useful for async operations that need a result from the host
     * @param method - The method/action name
     * @param data - Request data (must be JSON-serializable)
     * @returns Promise that resolves with the response data
     */
    request<T = any>(method: string, data?: any): Promise<T>;
  };

  // ============================================================================
  // Web Standard APIs
  // ============================================================================

  // Console (STUBBED - all methods are no-ops)
  // Implement logging via NETWORK.send() if needed
  const console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
    info(...args: any[]): void;
    debug(...args: any[]): void;
    trace(...args: any[]): void;
    dir(obj: any, options?: any): void;
    dirxml(...args: any[]): void;
    table(data: any, columns?: string[]): void;
    group(...label: any[]): void;
    groupCollapsed(...label: any[]): void;
    groupEnd(): void;
    clear(): void;
    count(label?: string): void;
    countReset(label?: string): void;
    assert(condition?: boolean, ...data: any[]): void;
    time(label?: string): void;
    timeLog(label?: string, ...data: any[]): void;
    timeEnd(label?: string): void;
  };

  // Timers
  function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
  function clearTimeout(id: number): void;
  function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
  function clearInterval(id: number): void;

  // Base64
  function atob(data: string): string;
  function btoa(data: string): string;

  // Crypto
  const crypto: Crypto;

  // Performance
  const performance: Performance;

  // Error reporting
  function reportError(error: any): void;

  // Structured clone
  function structuredClone<T>(value: T, options?: StructuredSerializeOptions): T;

  // ============================================================================
  // Fetch API (proxied through host)
  // ============================================================================

  /**
   * Fetch API - proxied through host
   * The host decides if the URL is allowed. Blocked URLs will result in an error.
   */
  function fetch(url: string | URL, init?: RequestInit): Promise<Response>;

  class Headers {
    constructor(init?: HeadersInit);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): Iterator<[string, string]>;
  }

  type HeadersInit = Headers | string[][] | Record<string, string>;

  interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: string;
  }

  interface Response {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Headers;
    json(): Promise<any>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
  }

  // ============================================================================
  // WebSocket API (proxied through host)
  // ============================================================================

  class WebSocket extends EventTarget {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    constructor(url: string);

    readonly readyState: number;
    readonly url: string;

    onopen: ((this: WebSocket, ev: Event) => any) | null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
    onerror: ((this: WebSocket, ev: ErrorEvent) => any) | null;

    send(data: string): void;
    close(code?: number, reason?: string): void;
  }

  // ============================================================================
  // Standard Web APIs (Streams, Events, Encoding, etc.)
  // ============================================================================

  // Abort APIs
  class AbortController {
    constructor();
    readonly signal: AbortSignal;
    abort(reason?: any): void;
  }

  class AbortSignal extends EventTarget {
    readonly aborted: boolean;
    readonly reason: any;
    static abort(reason?: any): AbortSignal;
    static timeout(milliseconds: number): AbortSignal;
  }

  // Blob and File APIs
  class Blob {
    constructor(blobParts?: BlobPart[], options?: BlobPropertyBag);
    readonly size: number;
    readonly type: string;
    slice(start?: number, end?: number, contentType?: string): Blob;
    stream(): ReadableStream<Uint8Array>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  type BlobPart = BufferSource | Blob | string;

  interface BlobPropertyBag {
    type?: string;
    endings?: 'transparent' | 'native';
  }

  class File extends Blob {
    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag);
    readonly name: string;
    readonly lastModified: number;
  }

  interface FilePropertyBag extends BlobPropertyBag {
    lastModified?: number;
  }

  class FileReader extends EventTarget {
    constructor();
    readonly error: DOMException | null;
    readonly readyState: number;
    readonly result: string | ArrayBuffer | null;
    abort(): void;
    readAsArrayBuffer(blob: Blob): void;
    readAsDataURL(blob: Blob): void;
    readAsText(blob: Blob, encoding?: string): void;
  }

  // Stream APIs
  class ReadableStream<R = any> {
    constructor(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>);
    readonly locked: boolean;
    cancel(reason?: any): Promise<void>;
    getReader(options?: { mode?: 'byob' }): ReadableStreamDefaultReader<R>;
    pipeThrough<T>(transform: ReadableWritablePair<T, R>, options?: StreamPipeOptions): ReadableStream<T>;
    pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
    tee(): [ReadableStream<R>, ReadableStream<R>];
  }

  class WritableStream<W = any> {
    constructor(underlyingSink?: UnderlyingSink<W>, strategy?: QueuingStrategy<W>);
    readonly locked: boolean;
    abort(reason?: any): Promise<void>;
    close(): Promise<void>;
    getWriter(): WritableStreamDefaultWriter<W>;
  }

  class TransformStream<I = any, O = any> {
    constructor(transformer?: Transformer<I, O>, writableStrategy?: QueuingStrategy<I>, readableStrategy?: QueuingStrategy<O>);
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }

  interface ReadableWritablePair<R = any, W = any> {
    readable: ReadableStream<R>;
    writable: WritableStream<W>;
  }

  interface StreamPipeOptions {
    preventClose?: boolean;
    preventAbort?: boolean;
    preventCancel?: boolean;
    signal?: AbortSignal;
  }

  class ReadableStreamDefaultReader<R = any> {
    constructor(stream: ReadableStream<R>);
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<void>;
    read(): Promise<ReadableStreamReadResult<R>>;
    releaseLock(): void;
  }

  interface ReadableStreamReadResult<T> {
    done: boolean;
    value: T;
  }

  class WritableStreamDefaultWriter<W = any> {
    constructor(stream: WritableStream<W>);
    readonly closed: Promise<undefined>;
    readonly desiredSize: number | null;
    readonly ready: Promise<undefined>;
    abort(reason?: any): Promise<void>;
    close(): Promise<void>;
    releaseLock(): void;
    write(chunk: W): Promise<void>;
  }

  class ByteLengthQueuingStrategy implements QueuingStrategy<ArrayBufferView> {
    constructor(init: { highWaterMark: number });
    readonly highWaterMark: number;
    size(chunk: ArrayBufferView): number;
  }

  class CountQueuingStrategy implements QueuingStrategy {
    constructor(init: { highWaterMark: number });
    readonly highWaterMark: number;
    size(): 1;
  }

  // Compression
  class CompressionStream extends TransformStream<BufferSource, Uint8Array> {
    constructor(format: 'gzip' | 'deflate' | 'deflate-raw');
  }

  class DecompressionStream extends TransformStream<BufferSource, Uint8Array> {
    constructor(format: 'gzip' | 'deflate' | 'deflate-raw');
  }

  // Text Encoding
  class TextEncoder {
    constructor();
    readonly encoding: string;
    encode(input?: string): Uint8Array;
    encodeInto(source: string, destination: Uint8Array): TextEncoderEncodeIntoResult;
  }

  interface TextEncoderEncodeIntoResult {
    read: number;
    written: number;
  }

  class TextDecoder {
    constructor(label?: string, options?: TextDecoderOptions);
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: BufferSource, options?: TextDecodeOptions): string;
  }

  interface TextDecoderOptions {
    fatal?: boolean;
    ignoreBOM?: boolean;
  }

  interface TextDecodeOptions {
    stream?: boolean;
  }

  class TextEncoderStream extends TransformStream<string, Uint8Array> {
    constructor();
    readonly encoding: string;
  }

  class TextDecoderStream extends TransformStream<BufferSource, string> {
    constructor(label?: string, options?: TextDecoderOptions);
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
  }

  // URL APIs
  class URL {
    constructor(url: string, base?: string | URL);
    hash: string;
    host: string;
    hostname: string;
    href: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toString(): string;
    toJSON(): string;
  }

  class URLSearchParams {
    constructor(init?: string | URLSearchParams | Record<string, string> | string[][]);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    toString(): string;
    forEach(callback: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: any): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): Iterator<[string, string]>;
  }

  class URLPattern {
    constructor(input?: string | URLPatternInit, baseURL?: string);
    readonly protocol: string;
    readonly username: string;
    readonly password: string;
    readonly hostname: string;
    readonly port: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
    test(input?: string | URLPatternInit, baseURL?: string): boolean;
    exec(input?: string | URLPatternInit, baseURL?: string): URLPatternResult | null;
  }

  // Event APIs
  class Event {
    constructor(type: string, eventInitDict?: EventInit);
    readonly type: string;
    readonly bubbles: boolean;
    readonly cancelable: boolean;
    readonly composed: boolean;
    readonly currentTarget: EventTarget | null;
    readonly defaultPrevented: boolean;
    readonly eventPhase: number;
    readonly target: EventTarget | null;
    readonly timeStamp: number;
    readonly isTrusted: boolean;
    composedPath(): EventTarget[];
    preventDefault(): void;
    stopImmediatePropagation(): void;
    stopPropagation(): void;
  }

  class EventTarget {
    constructor();
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
    dispatchEvent(event: Event): boolean;
  }

  class CustomEvent<T = any> extends Event {
    constructor(type: string, eventInitDict?: CustomEventInit<T>);
    readonly detail: T;
  }

  class MessageEvent<T = any> extends Event {
    constructor(type: string, eventInitDict?: MessageEventInit<T>);
    readonly data: T;
    readonly origin: string;
    readonly lastEventId: string;
    readonly source: MessageEventSource | null;
    readonly ports: ReadonlyArray<MessagePort>;
  }

  class ErrorEvent extends Event {
    constructor(type: string, eventInitDict?: ErrorEventInit);
    readonly message: string;
    readonly filename: string;
    readonly lineno: number;
    readonly colno: number;
    readonly error: any;
  }

  class CloseEvent extends Event {
    constructor(type: string, eventInitDict?: CloseEventInit);
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
  }

  class PromiseRejectionEvent extends Event {
    constructor(type: string, eventInitDict: PromiseRejectionEventInit);
    readonly promise: Promise<any>;
    readonly reason: any;
  }

  class ProgressEvent extends Event {
    constructor(type: string, eventInitDict?: ProgressEventInit);
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
  }

  // Message Channel
  class MessageChannel {
    constructor();
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }

  class MessagePort extends EventTarget {
    onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;
    close(): void;
    postMessage(message: any, transfer?: Transferable[]): void;
    start(): void;
  }

  // Broadcast Channel
  class BroadcastChannel extends EventTarget {
    constructor(name: string);
    readonly name: string;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
    close(): void;
    postMessage(message: any): void;
  }

  // Performance
  class Performance extends EventTarget {
    now(): number;
    timeOrigin: number;
    mark(markName: string, markOptions?: PerformanceMarkOptions): PerformanceMark;
    measure(measureName: string, startOrMeasureOptions?: string | PerformanceMeasureOptions, endMark?: string): PerformanceMeasure;
    clearMarks(markName?: string): void;
    clearMeasures(measureName?: string): void;
    getEntries(): PerformanceEntryList;
    getEntriesByName(name: string, type?: string): PerformanceEntryList;
    getEntriesByType(type: string): PerformanceEntryList;
  }

  class PerformanceEntry {
    readonly name: string;
    readonly entryType: string;
    readonly startTime: number;
    readonly duration: number;
    toJSON(): any;
  }

  class PerformanceMark extends PerformanceEntry {
    readonly detail: any;
  }

  class PerformanceMeasure extends PerformanceEntry {
    readonly detail: any;
  }

  // Image Data
  class ImageData {
    constructor(sw: number, sh: number, settings?: ImageDataSettings);
    constructor(data: Uint8ClampedArray, sw: number, sh?: number, settings?: ImageDataSettings);
    readonly data: Uint8ClampedArray;
    readonly height: number;
    readonly width: number;
    readonly colorSpace: PredefinedColorSpace;
  }

  // DOMException
  class DOMException extends Error {
    constructor(message?: string, name?: string);
    readonly code: number;
  }
}

export {};
