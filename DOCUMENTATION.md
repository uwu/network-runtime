# NETWORK Runtime Documentation

A secure V8 isolate-based JavaScript runtime with event-driven communication between main and worker isolates.

## Table of Contents

- [Main Isolate API](#main-isolate-api)
  - [V8Sandbox](#v8sandbox)
  - [Isolate](#isolate)
- [Worker Isolate API](#worker-isolate-api)
  - [NETWORK Global](#network-global)
  - [fetch()](#fetch)
  - [WebSocket](#websocket)
  - [Available Web APIs](#available-web-apis)
- [Examples](#examples)

---

## Main Isolate API

The main isolate has full Node.js/Deno capabilities and manages worker isolates.

### V8Sandbox

The sandbox manager for creating and managing worker isolates.

```javascript
const sandbox = new V8Sandbox();
```

#### Methods

##### `async createIsolate(): Promise<Isolate>`

Creates a new worker isolate.

```javascript
const worker = await sandbox.createIsolate();
console.log(`Created ${worker}`); // "Isolate #0"
```

##### `threadCount(): number`

Returns the number of worker threads in the pool.

```javascript
console.log(sandbox.threadCount()); // 4
```

##### `isolateCount(): number`

Returns the number of active isolates.

```javascript
console.log(sandbox.isolateCount()); // 5
```

##### `shutdown(): void`

Shuts down all worker threads and the sandbox.

```javascript
sandbox.shutdown();
```

---

### Isolate

Represents a single worker isolate. Created via `sandbox.createIsolate()`.

#### Properties

##### `id: number`

The unique isolate ID.

```javascript
console.log(worker.id); // 0
```

##### `destroyed: boolean`

Whether the isolate has been destroyed.

```javascript
console.log(worker.destroyed); // false
```

#### Methods

##### `execute(script: string): void`

Executes JavaScript code in the worker isolate (fire-and-forget).

```javascript
worker.execute(`
  console.log('Hello from worker!');
  const x = 1 + 1;
  console.log('Result:', x);
`);
```

##### `send(event: string, data: any): void`

Sends a message to the worker isolate.

```javascript
worker.send('custom-event', { message: 'Hello worker!' });
```

##### `on(event: string, handler: Function): Isolate`

Registers an event handler for messages from the worker.

```javascript
worker.on('custom-event', (data) => {
  console.log('Received from worker:', data);
});
```

Returns the isolate for method chaining.

##### `onRequest(method: string, handler: Function): Isolate`

Registers a request handler for async request/response from the worker.

```javascript
worker.onRequest('fetch', async (data) => {
  // Validate URL
  if (!data.url.startsWith('https://allowed-domain.com/')) {
    throw new Error('URL not allowed');
  }

  // Make actual fetch request
  const response = await fetch(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
});
```

The handler can be async and return a value. If an error is thrown, it's sent back to the worker.

Returns the isolate for method chaining.

##### `onSystem(eventType: string, handler: Function): Isolate`

Registers a handler for system events (secure events from Rust).

```javascript
worker.onSystem('terminated', (data) => {
  console.log('Worker was terminated:', data.reason);
});

worker.onSystem('destroyed', (data) => {
  console.log('Worker was destroyed:', data.reason);
});
```

System events:
- `terminated`: Worker exceeded CPU limit
- `destroyed`: Worker was manually destroyed

Returns the isolate for method chaining.

##### `off(event: string, handler: Function): Isolate`

Removes an event handler.

```javascript
const handler = (data) => console.log(data);
worker.on('event', handler);
worker.off('event', handler);
```

Returns the isolate for method chaining.

##### `destroy(): void`

Destroys the isolate and cleans up resources.

```javascript
worker.destroy();
```

##### `toString(): string`

Returns a string representation of the isolate.

```javascript
console.log(worker.toString()); // "Isolate #0"
console.log(String(worker));    // "Isolate #0"
```

---

## Worker Isolate API

Worker isolates are sandboxed environments with limited APIs. They cannot access the filesystem, network (except through the host), or native modules.

### NETWORK Global

The main communication interface between worker and host.

#### `NETWORK.send(event: string, data: any): void`

Sends a fire-and-forget message to the host.

```javascript
NETWORK.send('log', { message: 'Hello from worker!' });
```

#### `NETWORK.request(method: string, data: any): Promise<any>`

Sends a request to the host and waits for a response.

```javascript
const result = await NETWORK.request('fetch', {
  url: 'https://api.example.com/data',
  method: 'GET',
});
console.log(result);
```

**Note:** No timeout - waits indefinitely for host response.

#### `NETWORK.on(event: string, handler: Function): void`

Registers an event handler for messages from the host.

```javascript
NETWORK.on('custom-event', (data) => {
  console.log('Received from host:', data);
});
```

#### `NETWORK.off(event: string, handler: Function): void`

Removes an event handler.

```javascript
const handler = (data) => console.log(data);
NETWORK.on('event', handler);
NETWORK.off('event', handler);
```

---

### fetch()

A restricted fetch implementation that forwards requests to the host for validation and execution.

```javascript
async function fetch(url: string | URL, options?: {
  method?: string,
  headers?: object,
  body?: string,
}): Promise<Response>
```

#### Example

```javascript
const response = await fetch('https://api.example.com/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice' }),
});

console.log(response.ok);     // true
console.log(response.status); // 200

const data = await response.json();
console.log(data);
```

#### Response Object

The returned response object has these methods:

- `async json()`: Parse response body as JSON
- `async text()`: Get response body as text
- `async arrayBuffer()`: Get response body as ArrayBuffer
- `async blob()`: Get response body as Blob

Properties:
- `ok`: boolean
- `status`: number
- `statusText`: string
- `headers`: object

**Important:** The host must implement the `fetch` request handler to validate and execute requests. The worker has no direct network access.

---

### WebSocket

A WebSocket implementation using channel-based communication with the host.

```javascript
const ws = new WebSocket(url: string)
```

#### Properties

##### `readyState: number`

Current connection state:
- `WebSocket.CONNECTING` (0)
- `WebSocket.OPEN` (1)
- `WebSocket.CLOSING` (2)
- `WebSocket.CLOSED` (3)

##### `url: string`

The WebSocket URL.

#### Methods

##### `send(data: string): void`

Sends data through the WebSocket.

```javascript
ws.send('Hello!');
ws.send(JSON.stringify({ type: 'ping' }));
```

##### `close(code?: number, reason?: string): void`

Closes the WebSocket connection.

```javascript
ws.close();
ws.close(1000, 'Normal closure');
```

#### Events

Use `addEventListener` or direct event properties:

```javascript
// addEventListener style
ws.addEventListener('open', (event) => {
  console.log('Connected!');
});

// Direct property style
ws.onmessage = (event) => {
  console.log('Received:', event.data);
};
```

Available events:
- `open`: Connection established
- `message`: Message received (event.data contains the data)
- `close`: Connection closed (event.code and event.reason available)
- `error`: Error occurred (event.message contains error details)

#### Example

```javascript
const ws = new WebSocket('wss://gateway.example.com');

ws.addEventListener('open', () => {
  console.log('WebSocket opened!');
  ws.send('Hello from worker!');
});

ws.addEventListener('message', (event) => {
  console.log('Received:', event.data);
});

ws.addEventListener('close', (event) => {
  console.log('Closed:', event.code, event.reason);
});

ws.addEventListener('error', (event) => {
  console.error('Error:', event.message);
});
```

**Important:** The host must handle WebSocket events (`ws.open`, `ws.send`, `ws.close`) and forward data back to the worker using `worker.send('__ws_event', {...})`.

---

### Available Web APIs

Worker isolates have access to most standard Web APIs (excluding network access):

#### Timers
- `setTimeout(callback, delay)`
- `setInterval(callback, delay)`
- `clearTimeout(id)`
- `clearInterval(id)`

#### Console
**STUBBED** - All console methods are no-op functions.

Workers do not have access to the host console to prevent spam and maintain control. If you need logging from workers, implement it via `NETWORK.send()`:

```javascript
// Host - set up console message handler
worker.on('console', ({ level, args }) => {
  console[level]('[Worker]:', ...args);
});

// Worker - implement console wrapper
const workerConsole = {
  log: (...args) => NETWORK.send('console', { level: 'log', args }),
  error: (...args) => NETWORK.send('console', { level: 'error', args }),
  warn: (...args) => NETWORK.send('console', { level: 'warn', args }),
  info: (...args) => NETWORK.send('console', { level: 'info', args }),
};

// Use it
workerConsole.log('Hello from worker!');
```

#### Crypto
- `crypto.randomUUID()`
- `crypto.getRandomValues()`
- `crypto.subtle.*` (SubtleCrypto API)

#### Text Encoding
- `TextEncoder`
- `TextDecoder`
- `TextEncoderStream`
- `TextDecoderStream`

#### URLs
- `URL`
- `URLSearchParams`
- `URLPattern`

#### Binary Data
- `Blob`
- `File`
- `FileReader`

#### Streams
- `ReadableStream`
- `WritableStream`
- `TransformStream`
- Compression: `CompressionStream`, `DecompressionStream`

#### Events
- `Event`
- `EventTarget`
- `CustomEvent`
- `MessageEvent`
- `ErrorEvent`
- `CloseEvent`
- `ProgressEvent`
- `PromiseRejectionEvent`

#### Async Primitives
- `Promise`
- `AbortController`
- `AbortSignal`

#### Message Passing
- `MessageChannel`
- `MessagePort`
- `BroadcastChannel`

#### Performance
- `performance.now()`
- `PerformanceMark`
- `PerformanceMeasure`

#### Utilities
- `atob()`, `btoa()` (base64)
- `structuredClone()`
- `queueMicrotask()`

#### Not Available
- No filesystem access (`Deno.readFile`, `fs`, etc.)
- No network access except through `fetch` and `WebSocket` (validated by host)
- No native modules or Node.js APIs
- No `import` or `require` (unless bundled)

---

## Examples

### Basic Worker Communication

```javascript
// Main isolate
const sandbox = new V8Sandbox();
const worker = await sandbox.createIsolate();

// Listen for messages from worker
worker.on('result', (data) => {
  console.log('Worker result:', data);
});

// Execute worker code to set up its listeners FIRST
worker.execute(`
  NETWORK.on('compute', ({ x, y }) => {
    const result = x + y;
    NETWORK.send('result', { answer: result });
  });
`);

// Now send data to worker (after it has registered its listener)
worker.send('compute', { x: 5, y: 3 });
```

### Request/Response Pattern

```javascript
// Main isolate
worker.onRequest('getData', async (params) => {
  // Fetch from database or API
  const data = await database.query(params.query);
  return { data };
});

// Worker isolate
const response = await NETWORK.request('getData', {
  query: 'SELECT * FROM users'
});
console.log(response.data);
```

### HTTP Proxy with fetch

```javascript
// Main isolate
worker.onRequest('fetch', async (data) => {
  // Validate URL
  const allowedDomains = ['api.example.com', 'cdn.example.com'];
  const url = new URL(data.url);
  
  if (!allowedDomains.includes(url.hostname)) {
    throw new Error(`Domain not allowed: ${url.hostname}`);
  }

  // Forward request
  const response = await fetch(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
});

// Worker isolate
const response = await fetch('https://api.example.com/users');
const users = await response.json();
console.log(users);
```

### WebSocket Gateway

```javascript
// Main isolate
const wsConnections = new Map();

worker.on('ws.open', ({ conn_id, url }) => {
  console.log(`Worker wants to connect to ${url}`);
  
  // Validate URL
  if (!url.startsWith('wss://gateway.example.com')) {
    worker.send('__ws_event', {
      conn_id,
      event_type: 'error',
      data: { message: 'Invalid gateway URL' }
    });
    return;
  }

  // Connect to real gateway
  const ws = new WebSocket(url);
  wsConnections.set(conn_id, ws);

  ws.on('open', () => {
    worker.send('__ws_event', { conn_id, event_type: 'open' });
  });

  ws.on('message', (data) => {
    worker.send('__ws_event', {
      conn_id,
      event_type: 'message',
      data: data.toString()
    });
  });

  ws.on('close', () => {
    worker.send('__ws_event', {
      conn_id,
      event_type: 'close',
      data: { code: 1000, reason: 'Connection closed' }
    });
    wsConnections.delete(conn_id);
  });
});

worker.on('ws.send', ({ conn_id, data }) => {
  const ws = wsConnections.get(conn_id);
  if (ws) ws.send(data);
});

worker.on('ws.close', ({ conn_id }) => {
  const ws = wsConnections.get(conn_id);
  if (ws) ws.close();
  wsConnections.delete(conn_id);
});

// Worker isolate
const ws = new WebSocket('wss://gateway.example.com');

ws.addEventListener('open', () => {
  console.log('Connected!');
  ws.send(JSON.stringify({ op: 2, d: { token: 'xxx' } }));
});

ws.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  console.log('Received:', payload);
});
```

### CPU Time Limits

Worker isolates are automatically terminated if they exceed the configured CPU time limit:

```javascript
// Main isolate
worker.onSystem('terminated', (data) => {
  console.log('Worker terminated:', data.reason);
  // data.reason === 'cpu_limit_exceeded'
});

// Worker isolate (this will be terminated)
let i = 0;
while (true) {
  i++; // Runs until CPU limit is hit
}
```

The CPU limit is configured when starting the runtime (command-line argument).

### Memory Limits

Worker isolates can be restricted to a maximum heap size using V8's memory constraints:

```bash
# Set 128MB memory limit per worker
./network-runtime script.js 4 10000 128

# No memory limit (unlimited)
./network-runtime script.js 4 10000 0
```

**Important Notes:**

- Memory limits are enforced at the V8 heap level
- When a worker exceeds its memory limit, V8 behavior can be unpredictable:
  - Script may terminate silently
  - Isolate may hang
  - No catchable JavaScript error is thrown
- For production use, combine memory limits with:
  - Operation timeouts
  - Health monitoring
  - Periodic worker restart strategies

**Example:**
```javascript
// Main isolate
worker.execute(`
  // This will eventually hit the memory limit
  const arrays = [];
  while (true) {
    arrays.push(new Array(1024 * 1024)); // Allocate 1MB arrays
  }
`);

// Worker may terminate silently or hang when limit is reached
// Use timeouts and system events to detect unresponsive workers
```

---

## Security Considerations

1. **No Direct Network Access**: Workers cannot make network requests directly. All requests must go through the host via `fetch` or `WebSocket`, allowing the host to validate and control access.

2. **No Filesystem Access**: Workers cannot read or write files directly.

3. **CPU Limits**: Workers are automatically terminated if they exceed CPU time limits, preventing infinite loops from consuming resources.

4. **Memory Limits**: Workers can be constrained to a maximum heap size via V8 constraints, preventing excessive memory consumption.

5. **Isolated Execution**: Each worker runs in a separate V8 isolate with no shared memory or globals with other workers or the main isolate.

6. **Host Validation**: The host has full control over what URLs workers can access, what requests they can make, and what data they can receive.

7. **Event-Driven Communication**: All communication is message-based with no direct function calls between isolates, providing a clear security boundary.
