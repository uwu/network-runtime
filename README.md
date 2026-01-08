# V8 Sandbox Runtime

A JavaScript runtime built on deno_core with isolated worker contexts and Deno API support.

## Overview

This runtime provides a privileged main isolate with full Deno APIs and the ability to spawn isolated worker contexts. Workers are sandboxed V8 isolates that can only communicate with the host through a controlled messaging API.

Built on top of deno_core and rusty_v8, this runtime inherits both the capabilities and limitations of those projects.

## Key Features

- **Isolated Workers**: Spawn V8 isolates in a thread pool, completely isolated from each other
- **Deno APIs**: Main isolate has access to filesystem, network, and other Deno runtime APIs
- **Controlled Communication**: Bi-directional messaging between host and workers with async request/response
- **Network Proxying**: Workers can use fetch() and WebSocket, proxied through the host with URL validation
- **Multi-threaded**: Worker pool distributes isolates across configurable number of threads

## Architecture

The runtime has two execution environments:

**Main/Host Isolate:**
- Full Deno API (fs, net, crypto, fetch, etc.)
- V8Sandbox class for managing worker isolates
- Direct system access

**Worker Isolates:**
- Web standard APIs (timers, crypto, streams, etc.)
- Console is stubbed (implement via NETWORK.send() if needed)
- NETWORK global for host communication
- NO filesystem access
- NO direct network access (must proxy through host)

## Build

```bash
# Requires V8 to be built from source
V8_FROM_SOURCE=1 cargo build --release
```

Requirements:
- Rust 1.70+
- Python 3
- ~2GB disk space for V8 build
- Linux or macOS

## Usage

```bash
./target/release/network-runtime <script.js> [threads] [cpu_limit_ms] [memory_limit_mb] [--verbose|-v]
```

**Parameters:**
- `threads` - Number of worker threads (default: 2)
- `cpu_limit_ms` - CPU time limit per isolate in milliseconds (default: 500)
- `memory_limit_mb` - Memory limit per isolate in megabytes (default: 0 = unlimited)
- `--verbose` or `-v` - Enable debug logging

**Examples:**
```bash
./target/release/network-runtime main.js 4 10000 128        # 4 threads, 10s CPU, 128MB memory
./target/release/network-runtime main.js 2 5000 0           # No memory limit
./target/release/network-runtime main.js 4 1000 256 -v      # With debug logging
```

By default, the runtime runs quietly and only shows your script's output. Use `--verbose` or `-v` to see debug information about threads, isolates, CPU tracking, and memory limits.

## Quick Start

**main.js:**
```javascript
const sandbox = new V8Sandbox();
const worker = await sandbox.createIsolate();

// Host listens for worker messages
worker.on('result', (data) => {
  console.log('Result:', data);
});

// Set up worker's event handlers FIRST
worker.execute(`
  NETWORK.on('compute', (data) => {
    NETWORK.send('result', { answer: data.x + data.y });
  });
`);

// Then send messages
worker.send('compute', { x: 10, y: 5 });

// Clean up
worker.destroy();
sandbox.shutdown();
```

## API

### Host Environment

#### V8Sandbox
```javascript
const sandbox = new V8Sandbox();
const worker = await sandbox.createIsolate();  // Create worker
sandbox.threadCount();                          // Get thread count
sandbox.isolateCount();                         // Get active isolate count
sandbox.shutdown();                             // Shutdown all workers
```

#### Isolate
```javascript
worker.execute(code);                          // Execute code in worker
worker.send(event, data);                      // Send message to worker
worker.on(event, handler);                     // Listen for worker messages
worker.onRequest(method, async (data) => {});  // Handle async requests
worker.onSystem(event, handler);               // System events (secure)
worker.destroy();                               // Destroy worker
```

#### Deno APIs
```javascript
// Filesystem
await Deno.readTextFile(path);
await Deno.writeTextFile(path, data);
Deno.readDir(path);
Deno.cwd();

// Network
Deno.listen({ port });
await Deno.connect({ hostname, port });
await Deno.connectTls({ hostname, port });
await Deno.resolveDns(query, recordType);

// Web standards
await fetch(url);
crypto.randomUUID();
```

### Worker Environment

#### NETWORK Global
```javascript
NETWORK.on(event, handler);              // Listen for host messages
NETWORK.send(event, data);               // Send message to host
await NETWORK.request(method, data);     // Request/response with host
NETWORK.off(event, handler);             // Remove listener
```

#### Available Web APIs
- setTimeout, setInterval, timers
- crypto (WebCrypto API)
- fetch() (proxied through host)
- WebSocket (proxied through host)
- URL, URLSearchParams, URLPattern
- TextEncoder, TextDecoder
- Blob, File, FileReader
- Streams (ReadableStream, WritableStream, TransformStream)
- Events (Event, EventTarget, CustomEvent, etc.)
- AbortController, AbortSignal
- performance.now()

**Note:** `console` is stubbed (all methods are no-ops). Implement logging via `NETWORK.send()` if needed. See [DOCUMENTATION.md](./DOCUMENTATION.md#console) for implementation examples.

## Examples

### Request/Response Pattern

Host:
```javascript
worker.onRequest('readFile', async ({ path }) => {
  const content = await Deno.readTextFile(path);
  return { content };
});
```

Worker:
```javascript
const result = await NETWORK.request('readFile', { path: './config.json' });
console.log(result.content);
```

### Fetch Proxy with Validation

Host:
```javascript
worker.onRequest('fetch', async ({ url, method, headers, body }) => {
  // Validate URL
  const allowedDomains = ['api.example.com'];
  const parsed = new URL(url);

  if (!allowedDomains.includes(parsed.hostname)) {
    throw new Error('Domain not allowed');
  }

  const response = await fetch(url, { method, headers, body });
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text()
  };
});
```

Worker:
```javascript
// Built-in fetch automatically proxies through host
const response = await fetch('https://api.example.com/data');
const data = await response.json();
```

### Multiple Workers

```javascript
const sandbox = new V8Sandbox();
const workers = await Promise.all([
  sandbox.createIsolate(),
  sandbox.createIsolate(),
  sandbox.createIsolate()
]);

workers.forEach((worker, i) => {
  worker.on('done', (result) => {
    console.log(`Worker ${i}:`, result);
  });

  worker.execute(`
    NETWORK.on('task', async (data) => {
      // Process data
      NETWORK.send('done', { processed: data });
    });
  `);
});

// Distribute tasks
workers.forEach((worker, i) => {
  worker.send('task', { id: i, data: '...' });
});
```

## deno_core Limitations

This runtime is built on deno_core, which has several important limitations:

**No built-in module loader for HTTP imports**: Unlike Deno CLI, this runtime cannot fetch modules from URLs. You must bundle your code or use only local file imports.

**Limited extension ecosystem**: Only a subset of Deno's extensions are included. Some Deno CLI features (like FFI, subprocess, etc.) are not available.

**Manual extension initialization**: Extensions must be carefully ordered and initialized. Some ops require stubs when using custom deno_core forks.

**API surface differences**: While we expose Deno APIs, they're provided through individual extensions (deno_fs, deno_net, etc.) rather than the full Deno CLI runtime.

**TypeScript transpilation**: TypeScript support is provided via oxc transpiler, not the official Deno compiler. Some edge cases may behave differently.

## Security Model

Host isolate:
- Full system access
- All Deno APIs available
- Can spawn and control workers
- No restrictions

Worker isolates:
- No filesystem access
- No direct network access
- Network requests proxied through host for validation
- CPU time limits enforced per isolate
- Memory limits configurable (V8 heap limits)
- Memory isolated between workers
- Cannot communicate with other workers
- Cannot access host memory

Communication:
- All data serialized as JSON
- No shared object references
- System events cannot be spoofed by workers

## TypeScript Support

Type declarations available in `types/` directory:

```typescript
/// <reference path="./types/host.d.ts" />    // For main isolate
/// <reference path="./types/worker.d.ts" />  // For worker code
```

See [types/README.md](./types/README.md) for details.

## Documentation

- [DOCUMENTATION.md](./DOCUMENTATION.md) - Complete API reference
- [types/](./types/) - TypeScript type declarations

## Use Cases

- Running untrusted user code with controlled API access
- Plugin systems with sandboxed execution
- Multi-tenant code execution
- Parallel data processing with isolated contexts
- Bot frameworks with user-provided scripts

## Performance

Workers run in a thread pool. The runtime uses async message passing between host and workers. Isolates can be created and destroyed dynamically.

**Resource Limits:**
- CPU time limits enforced per isolate via background watcher thread
- Memory limits enforced via V8 heap constraints
- Configurable per-isolate or pool-wide defaults

**Note on Memory Limits:**
V8's heap limits prevent workers from exceeding allocated memory, but OOM behavior can be unpredictable (silent termination or hanging). For production use, combine memory limits with operation timeouts and health checks.

## License

MS-PL (Microsoft Public License)
