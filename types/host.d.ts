/**
 * TypeScript declarations for Host/Main environment
 *
 * The host environment has full access to:
 * - All Deno APIs (filesystem, network, etc.)
 * - V8Sandbox management for creating/managing worker isolates
 * - All Web APIs (console, fetch, crypto, etc.)
 */

/// <reference lib="deno.ns" />

declare global {
  // ============================================================================
  // V8Sandbox Management API
  // ============================================================================

  /**
   * V8Sandbox - Manages worker isolates from the main isolate
   */
  class V8Sandbox {
    /**
     * Create a new worker isolate
     * @returns Promise that resolves to the created Isolate instance
     */
    createIsolate(): Promise<Isolate>;

    /**
     * Get the number of worker threads in the pool
     * @returns Number of worker threads
     */
    threadCount(): number;

    /**
     * Get the number of active isolates across all threads
     * @returns Number of active isolates
     */
    isolateCount(): number;

    /**
     * Shutdown the entire sandbox system
     * Destroys all isolates and stops all worker threads
     */
    shutdown(): void;
  }

  /**
   * Isolate - Represents a single worker isolate
   * Worker isolates are isolated JavaScript execution contexts
   */
  class Isolate {
    /**
     * Get the isolate's unique ID
     */
    readonly id: number;

    /**
     * Check if the isolate has been destroyed
     */
    readonly destroyed: boolean;

    /**
     * Register an event handler for messages from this isolate
     * @param event - The event name
     * @param handler - Callback invoked when the isolate sends this event
     * @returns This isolate (for chaining)
     */
    on(event: string, handler: (data: any) => void): this;

    /**
     * Register a system event handler (secure events from Rust runtime)
     * System events cannot be spoofed by worker code
     * @param eventType - System event type (e.g., "terminated", "destroyed")
     * @param handler - Callback invoked when the system event occurs
     * @returns This isolate (for chaining)
     */
    onSystem(eventType: string, handler: (data: any) => void): this;

    /**
     * Register a request handler for async request/response from worker
     * Workers use NETWORK.request() to call these handlers
     * @param method - The method name
     * @param handler - Handler function (can be async, return value sent as response)
     * @returns This isolate (for chaining)
     */
    onRequest<T = any, R = any>(method: string, handler: (data: T) => R | Promise<R>): this;

    /**
     * Remove an event handler
     * @param event - The event name
     * @param handler - The handler to remove
     * @returns This isolate (for chaining)
     */
    off(event: string, handler: (data: any) => void): this;

    /**
     * Send a one-way message to this isolate
     * The isolate receives this via NETWORK.on(event, handler)
     * @param event - The event name
     * @param data - Data to send (must be JSON-serializable)
     * @throws Error if the isolate has been destroyed
     */
    send(event: string, data: any): void;

    /**
     * Execute JavaScript code in this isolate
     * Code runs in the worker's context with access to NETWORK API
     * @param script - JavaScript code to execute
     * @throws Error if the isolate has been destroyed
     */
    execute(script: string): void;

    /**
     * Destroy this isolate
     * Terminates the isolate and frees all resources
     * @throws Error if the isolate has already been destroyed
     */
    destroy(): void;

    /**
     * String representation of the isolate
     */
    toString(): string;
  }

  // ============================================================================
  // Deno Namespace - Full Deno API surface
  // ============================================================================

  namespace Deno {
    /**
     * Version information
     */
    export const version: {
      deno: string;
      v8: string;
      typescript: string;
    };

    // Filesystem APIs
    export function readTextFile(path: string | URL): Promise<string>;
    export function readTextFileSync(path: string | URL): string;
    export function readFile(path: string | URL): Promise<Uint8Array>;
    export function readFileSync(path: string | URL): Uint8Array;
    export function writeTextFile(path: string | URL, data: string, options?: WriteFileOptions): Promise<void>;
    export function writeTextFileSync(path: string | URL, data: string, options?: WriteFileOptions): void;
    export function writeFile(path: string | URL, data: Uint8Array, options?: WriteFileOptions): Promise<void>;
    export function writeFileSync(path: string | URL, data: Uint8Array, options?: WriteFileOptions): void;
    export function open(path: string | URL, options?: OpenOptions): Promise<FsFile>;
    export function openSync(path: string | URL, options?: OpenOptions): FsFile;
    export function create(path: string | URL): Promise<FsFile>;
    export function createSync(path: string | URL): FsFile;
    export function readDir(path: string | URL): AsyncIterable<DirEntry>;
    export function readDirSync(path: string | URL): Iterable<DirEntry>;
    export function mkdir(path: string | URL, options?: MkdirOptions): Promise<void>;
    export function mkdirSync(path: string | URL, options?: MkdirOptions): void;
    export function makeTempDir(options?: MakeTempOptions): Promise<string>;
    export function makeTempDirSync(options?: MakeTempOptions): string;
    export function makeTempFile(options?: MakeTempOptions): Promise<string>;
    export function makeTempFileSync(options?: MakeTempOptions): string;
    export function remove(path: string | URL, options?: RemoveOptions): Promise<void>;
    export function removeSync(path: string | URL, options?: RemoveOptions): void;
    export function rename(oldpath: string | URL, newpath: string | URL): Promise<void>;
    export function renameSync(oldpath: string | URL, newpath: string | URL): void;
    export function copyFile(fromPath: string | URL, toPath: string | URL): Promise<void>;
    export function copyFileSync(fromPath: string | URL, toPath: string | URL): void;
    export function readLink(path: string | URL): Promise<string>;
    export function readLinkSync(path: string | URL): string;
    export function lstat(path: string | URL): Promise<FileInfo>;
    export function lstatSync(path: string | URL): FileInfo;
    export function stat(path: string | URL): Promise<FileInfo>;
    export function statSync(path: string | URL): FileInfo;
    export function link(oldpath: string | URL, newpath: string | URL): Promise<void>;
    export function linkSync(oldpath: string | URL, newpath: string | URL): void;
    export function symlink(oldpath: string | URL, newpath: string | URL, options?: SymlinkOptions): Promise<void>;
    export function symlinkSync(oldpath: string | URL, newpath: string | URL, options?: SymlinkOptions): void;
    export function chmod(path: string | URL, mode: number): Promise<void>;
    export function chmodSync(path: string | URL, mode: number): void;
    export function chown(path: string | URL, uid: number | null, gid: number | null): Promise<void>;
    export function chownSync(path: string | URL, uid: number | null, gid: number | null): void;
    export function realPath(path: string | URL): Promise<string>;
    export function realPathSync(path: string | URL): string;
    export function cwd(): string;
    export function chdir(directory: string | URL): void;

    // Network APIs
    export function listen(options: ListenOptions & { transport?: "tcp" }): Listener;
    export function listen(options: ListenOptions & { transport: "unix" }): Listener;
    export function listenTls(options: ListenTlsOptions): TlsListener;
    export function connect(options: ConnectOptions): Promise<TcpConn>;
    export function connectTls(options: ConnectTlsOptions): Promise<TlsConn>;
    export function resolveDns(query: string, recordType: RecordType, options?: ResolveDnsOptions): Promise<DnsRecord[]>;

    // I/O
    export const stdin: Reader & ReaderSync & Closer & { readonly rid: number; readonly isTerminal: boolean };
    export const stdout: Writer & WriterSync & Closer & { readonly rid: number; readonly isTerminal: boolean };
    export const stderr: Writer & WriterSync & Closer & { readonly rid: number; readonly isTerminal: boolean };

    // Types
    export interface WriteFileOptions {
      append?: boolean;
      create?: boolean;
      createNew?: boolean;
      mode?: number;
      signal?: AbortSignal;
    }

    export interface OpenOptions {
      read?: boolean;
      write?: boolean;
      append?: boolean;
      truncate?: boolean;
      create?: boolean;
      createNew?: boolean;
      mode?: number;
    }

    export interface DirEntry {
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
    }

    export interface MkdirOptions {
      recursive?: boolean;
      mode?: number;
    }

    export interface MakeTempOptions {
      dir?: string;
      prefix?: string;
      suffix?: string;
    }

    export interface RemoveOptions {
      recursive?: boolean;
    }

    export interface FileInfo {
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
      size: number;
      mtime: Date | null;
      atime: Date | null;
      birthtime: Date | null;
      dev: number;
      ino: number | null;
      mode: number | null;
      nlink: number | null;
      uid: number | null;
      gid: number | null;
      rdev: number | null;
      blksize: number | null;
      blocks: number | null;
    }

    export interface SymlinkOptions {
      type: "file" | "dir";
    }

    export interface FsFile extends Reader, ReaderSync, Writer, WriterSync, Seeker, SeekerSync, Closer {
      readonly rid: number;
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
      stat(): Promise<FileInfo>;
      statSync(): FileInfo;
      truncate(len?: number): Promise<void>;
      truncateSync(len?: number): void;
      read(p: Uint8Array): Promise<number | null>;
      readSync(p: Uint8Array): number | null;
      write(p: Uint8Array): Promise<number>;
      writeSync(p: Uint8Array): number;
      seek(offset: number, whence: SeekMode): Promise<number>;
      seekSync(offset: number, whence: SeekMode): number;
      close(): void;
    }

    export interface Reader {
      read(p: Uint8Array): Promise<number | null>;
    }

    export interface ReaderSync {
      readSync(p: Uint8Array): number | null;
    }

    export interface Writer {
      write(p: Uint8Array): Promise<number>;
    }

    export interface WriterSync {
      writeSync(p: Uint8Array): number;
    }

    export interface Closer {
      close(): void;
    }

    export interface Seeker {
      seek(offset: number, whence: SeekMode): Promise<number>;
    }

    export interface SeekerSync {
      seekSync(offset: number, whence: SeekMode): number;
    }

    export enum SeekMode {
      Start = 0,
      Current = 1,
      End = 2,
    }

    // Network types
    export interface ListenOptions {
      hostname?: string;
      port: number;
      transport?: "tcp" | "unix";
    }

    export interface ListenTlsOptions extends ListenOptions {
      cert: string;
      key: string;
      alpnProtocols?: string[];
    }

    export interface ConnectOptions {
      hostname: string;
      port: number;
      transport?: "tcp";
    }

    export interface ConnectTlsOptions extends ConnectOptions {
      certFile?: string;
      caCerts?: string[];
      alpnProtocols?: string[];
    }

    export interface Listener extends AsyncIterable<Conn> {
      readonly addr: Addr;
      accept(): Promise<Conn>;
      close(): void;
      [Symbol.asyncIterator](): AsyncIterableIterator<Conn>;
    }

    export interface TlsListener extends AsyncIterable<TlsConn> {
      readonly addr: Addr;
      accept(): Promise<TlsConn>;
      close(): void;
      [Symbol.asyncIterator](): AsyncIterableIterator<TlsConn>;
    }

    export interface Conn extends Reader, Writer, Closer {
      readonly rid: number;
      readonly localAddr: Addr;
      readonly remoteAddr: Addr;
      closeWrite(): Promise<void>;
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
    }

    export interface TcpConn extends Conn {
      setNoDelay(nodelay?: boolean): void;
      setKeepAlive(keepalive?: boolean): void;
    }

    export interface TlsConn extends TcpConn {
      handshake(): Promise<TlsHandshakeInfo>;
    }

    export interface TlsHandshakeInfo {
      alpnProtocol: string | null;
    }

    export type Addr = NetAddr | UnixAddr;

    export interface NetAddr {
      transport: "tcp" | "udp";
      hostname: string;
      port: number;
    }

    export interface UnixAddr {
      transport: "unix" | "unixpacket";
      path: string;
    }

    export type RecordType =
      | "A"
      | "AAAA"
      | "ANAME"
      | "CAA"
      | "CNAME"
      | "MX"
      | "NAPTR"
      | "NS"
      | "PTR"
      | "SOA"
      | "SRV"
      | "TXT";

    export type DnsRecord =
      | { type: "A"; content: string }
      | { type: "AAAA"; content: string }
      | { type: "ANAME"; content: string }
      | { type: "CAA"; critical: boolean; tag: string; value: string }
      | { type: "CNAME"; content: string }
      | { type: "MX"; preference: number; exchange: string }
      | { type: "NAPTR"; order: number; preference: number; flags: string; services: string; regexp: string; replacement: string }
      | { type: "NS"; content: string }
      | { type: "PTR"; content: string }
      | { type: "SOA"; mname: string; rname: string; serial: number; refresh: number; retry: number; expire: number; minimum: number }
      | { type: "SRV"; priority: number; weight: number; port: number; target: string }
      | { type: "TXT"; content: string[] };

    export interface ResolveDnsOptions {
      nameServer?: { ipAddr: string; port?: number };
    }
  }

  // ============================================================================
  // Global Web APIs (same as worker, but with real implementations)
  // ============================================================================

  const console: Console;

  function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
  function clearTimeout(id: number): void;
  function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
  function clearInterval(id: number): void;

  function atob(data: string): string;
  function btoa(data: string): string;

  const crypto: Crypto;
  const performance: Performance;

  function reportError(error: any): void;
  function structuredClone<T>(value: T, options?: StructuredSerializeOptions): T;

  // Fetch API (real implementation, not proxied)
  function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export {};
