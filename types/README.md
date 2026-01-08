# TypeScript Type Declarations

This directory contains TypeScript declaration files for the V8 Sandbox Runtime environments.

## Files

### `worker.d.ts`
Type declarations for **worker/sandbox isolates**.

**Use this for:**
- Worker isolate code (code running in sandboxed contexts)
- Scripts executed via `isolate.execute()`

**Available APIs:**
- ✅ `NETWORK` global (messaging with host)
- ✅ Web APIs (console, timers, crypto, streams, etc.)
- ✅ `fetch()` (proxied through host - host validates URLs)
- ✅ `WebSocket` (proxied through host)
- ❌ NO filesystem access
- ❌ NO direct network access
- ❌ NO Deno APIs

**Example:**
```typescript
/// <reference path="./types/worker.d.ts" />

// Worker code
NETWORK.on('task', (data) => {
  console.log('Received task:', data);
  NETWORK.send('result', { status: 'complete' });
});

// Request data from host
const config = await NETWORK.request('getConfig');
console.log('Config:', config);
```

### `host.d.ts`
Type declarations for the **host/main isolate**.

**Use this for:**
- Main isolate code (privileged context)
- Code that manages worker isolates

**Available APIs:**
- ✅ `V8Sandbox` class (create/manage worker isolates)
- ✅ `Isolate` class (control individual workers)
- ✅ Full Deno API (`Deno.readFile`, `Deno.listen`, etc.)
- ✅ All Web APIs (console, fetch, crypto, etc.)
- ✅ Full filesystem and network access

**Example:**
```typescript
/// <reference path="./types/host.d.ts" />

// Create sandbox manager
const sandbox = new V8Sandbox();

// Create a worker isolate
const worker = await sandbox.createIsolate();

// Listen for messages from worker
worker.on('result', (data) => {
  console.log('Worker result:', data);
});

// Handle worker requests
worker.onRequest('getConfig', async () => {
  const config = await Deno.readTextFile('./config.json');
  return JSON.parse(config);
});

// Execute code in worker
worker.execute(`
  NETWORK.send('result', { hello: 'world' });
`);

// Use Deno APIs
const data = await Deno.readTextFile('./file.txt');
await fetch('https://api.example.com');
```

## Usage in Your IDE

### For Worker Code
Add this to the top of your worker script files:
```typescript
/// <reference path="./types/worker.d.ts" />
```

### For Host Code
Add this to the top of your main/host files:
```typescript
/// <reference path="./types/host.d.ts" />
```

### Using with tsconfig.json

For worker code:
```json
{
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["./types/worker.d.ts"]
  }
}
```

For host code:
```json
{
  "compilerOptions": {
    "lib": ["ES2022", "deno.ns"],
    "types": ["./types/host.d.ts"]
  }
}
```

## API Overview

### Worker → Host Communication

```typescript
// Worker side
NETWORK.send('event', { data: 'value' });           // Fire-and-forget
const result = await NETWORK.request('method', {}); // Request-response

// Host side
worker.on('event', (data) => { /* handle */ });
worker.onRequest('method', async (data) => { /* handle and return */ });
```

### Host → Worker Communication

```typescript
// Host side
worker.send('event', { data: 'value' });  // Send message to worker
worker.execute('console.log("hi")');      // Execute code in worker

// Worker side
NETWORK.on('event', (data) => { /* handle */ });
```

### Lifecycle Management

```typescript
// Create isolate
const worker = await sandbox.createIsolate();

// System events (cannot be spoofed by worker)
worker.onSystem('terminated', (data) => {
  console.log('Worker terminated:', data);
});

// Destroy isolate
worker.destroy();

// Shutdown entire sandbox
sandbox.shutdown();
```

## Notes

- Workers are **completely isolated** - they cannot access each other or the host directly
- All worker↔host communication must be **JSON-serializable**
- Workers can use `fetch()` and `WebSocket`, but requests are validated by the host
- Host has full system access via Deno APIs
- System events (`onSystem`) are secure and cannot be faked by worker code
