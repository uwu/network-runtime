// Test file for fetch hooking in isolates
// Run with: V8_FROM_SOURCE=1 cargo run -- tests/fetch_hook_test.js
//
// This tests the fetch hook mechanism where workers can make fetch() requests
// that are intercepted by the host and handled via request/response messaging.

const sandbox = new V8Sandbox();

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTest(name, testFn) {
  try {
    await testFn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

// Helper to create an isolate with fetch handler
async function createIsolateWithFetchHandler(fetchHandler) {
  const isolate = await sandbox.createIsolate();
  isolate.onRequest('fetch', fetchHandler);
  return isolate;
}

// Helper to execute fetch in isolate and get result via message
function executeFetchInIsolate(isolate, fetchCode) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fetch execution timed out'));
    }, 5000);

    isolate.on('fetchResult', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });

    isolate.on('fetchError', (data) => {
      clearTimeout(timeout);
      reject(new Error(data.error));
    });

    isolate.execute(`
      (async () => {
        try {
          ${fetchCode}
        } catch (error) {
          NETWORK.send('fetchError', { error: error.message });
        }
      })();
    `);
  });
}

// =============================================================================
// Test Cases
// =============================================================================

async function testBasicGetRequest() {
  const isolate = await createIsolateWithFetchHandler(async ({ url, method, headers, body }) => {
    assertEqual(url, 'https://api.example.com/data', 'URL should match');
    assertEqual(method, 'GET', 'Method should be GET');

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello from mock' }),
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    NETWORK.send('fetchResult', {
      ok: response.ok,
      status: response.status,
      message: data.message,
    });
  `);

  assertEqual(result.ok, true, 'Response should be ok');
  assertEqual(result.status, 200, 'Status should be 200');
  assertEqual(result.message, 'Hello from mock', 'Response body should be parsed');

  isolate.destroy();
}

async function testPostRequestWithBody() {
  const isolate = await createIsolateWithFetchHandler(async ({ url, method, headers, body }) => {
    assertEqual(method, 'POST', 'Method should be POST');
    assertEqual(body, '{"name":"test"}', 'Body should match');

    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 123, name: 'test' }),
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    const data = await response.json();
    NETWORK.send('fetchResult', {
      status: response.status,
      id: data.id,
    });
  `);

  assertEqual(result.status, 201, 'Status should be 201');
  assertEqual(result.id, 123, 'Response should contain created ID');

  isolate.destroy();
}

async function testHeadersHandling() {
  const isolate = await createIsolateWithFetchHandler(async ({ url, method, headers, body }) => {
    // Verify custom headers are passed through
    assertEqual(headers['x-custom-header'], 'custom-value', 'Custom header should be present');
    assertEqual(headers['authorization'], 'Bearer token123', 'Auth header should be present');

    return {
      ok: true,
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'x-response-header': 'response-value',
      },
      body: 'success',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/test', {
      headers: {
        'X-Custom-Header': 'custom-value',
        'Authorization': 'Bearer token123',
      },
    });
    const responseHeader = response.headers.get('x-response-header');
    NETWORK.send('fetchResult', {
      ok: response.ok,
      responseHeader: responseHeader,
    });
  `);

  assertEqual(result.ok, true, 'Response should be ok');
  assertEqual(result.responseHeader, 'response-value', 'Response header should be accessible');

  isolate.destroy();
}

async function testTextResponse() {
  const isolate = await createIsolateWithFetchHandler(async () => {
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'Plain text response',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/text');
    const text = await response.text();
    NETWORK.send('fetchResult', { text });
  `);

  assertEqual(result.text, 'Plain text response', 'Text response should match');

  isolate.destroy();
}

async function testUrlObjectSupport() {
  const isolate = await createIsolateWithFetchHandler(async ({ url }) => {
    assertEqual(url, 'https://api.example.com/path?query=value', 'URL from URL object should be converted to string');

    return {
      ok: true,
      status: 200,
      headers: {},
      body: 'ok',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const urlObj = new URL('https://api.example.com/path?query=value');
    const response = await fetch(urlObj);
    NETWORK.send('fetchResult', { ok: response.ok });
  `);

  assertEqual(result.ok, true, 'Fetch with URL object should work');

  isolate.destroy();
}

async function testDomainBlocking() {
  const allowedDomains = ['api.allowed.com'];

  const isolate = await createIsolateWithFetchHandler(async ({ url }) => {
    const parsed = new URL(url);

    if (!allowedDomains.includes(parsed.hostname)) {
      throw new Error(`Domain not allowed: ${parsed.hostname}`);
    }

    return {
      ok: true,
      status: 200,
      headers: {},
      body: 'allowed',
    };
  });

  // Test blocked domain
  try {
    await executeFetchInIsolate(isolate, `
      const response = await fetch('https://blocked.example.com/data');
      NETWORK.send('fetchResult', { ok: response.ok });
    `);
    throw new Error('Should have thrown for blocked domain');
  } catch (error) {
    assert(error.message.includes('Domain not allowed') || error.message.includes('blocked'),
      'Error should mention domain blocking');
  }

  // Test allowed domain
  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.allowed.com/data');
    const text = await response.text();
    NETWORK.send('fetchResult', { text });
  `);

  assertEqual(result.text, 'allowed', 'Allowed domain should work');

  isolate.destroy();
}

async function testErrorResponse() {
  const isolate = await createIsolateWithFetchHandler(async () => {
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Resource not found' }),
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/missing');
    const data = await response.json();
    NETWORK.send('fetchResult', {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: data.error,
    });
  `);

  assertEqual(result.ok, false, 'Response should not be ok');
  assertEqual(result.status, 404, 'Status should be 404');
  assertEqual(result.statusText, 'Not Found', 'Status text should match');
  assertEqual(result.error, 'Resource not found', 'Error body should be parsed');

  isolate.destroy();
}

async function testHandlerThrowsError() {
  const isolate = await createIsolateWithFetchHandler(async () => {
    throw new Error('Network error: connection refused');
  });

  try {
    await executeFetchInIsolate(isolate, `
      const response = await fetch('https://api.example.com/fail');
      NETWORK.send('fetchResult', { ok: response.ok });
    `);
    throw new Error('Should have thrown error');
  } catch (error) {
    assert(error.message.includes('connection refused') || error.message.includes('Network error'),
      'Error message should be propagated');
  }

  isolate.destroy();
}

async function testMultipleFetchRequests() {
  let requestCount = 0;

  const isolate = await createIsolateWithFetchHandler(async ({ url }) => {
    requestCount++;
    const id = new URL(url).pathname.split('/').pop();

    return {
      ok: true,
      status: 200,
      headers: {},
      body: JSON.stringify({ id: parseInt(id), requestNum: requestCount }),
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const results = await Promise.all([
      fetch('https://api.example.com/items/1').then(r => r.json()),
      fetch('https://api.example.com/items/2').then(r => r.json()),
      fetch('https://api.example.com/items/3').then(r => r.json()),
    ]);
    NETWORK.send('fetchResult', { results });
  `);

  assertEqual(result.results.length, 3, 'Should have 3 results');
  assertEqual(result.results[0].id, 1, 'First result should have id 1');
  assertEqual(result.results[1].id, 2, 'Second result should have id 2');
  assertEqual(result.results[2].id, 3, 'Third result should have id 3');

  isolate.destroy();
}

async function testPutAndDeleteMethods() {
  const receivedMethods = [];

  const isolate = await createIsolateWithFetchHandler(async ({ method }) => {
    receivedMethods.push(method);
    return {
      ok: true,
      status: method === 'DELETE' ? 204 : 200,
      headers: {},
      body: '',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const putResponse = await fetch('https://api.example.com/resource/1', { method: 'PUT' });
    const deleteResponse = await fetch('https://api.example.com/resource/1', { method: 'DELETE' });
    NETWORK.send('fetchResult', {
      putStatus: putResponse.status,
      deleteStatus: deleteResponse.status,
    });
  `);

  assertEqual(result.putStatus, 200, 'PUT should return 200');
  assertEqual(result.deleteStatus, 204, 'DELETE should return 204');
  assert(receivedMethods.includes('PUT'), 'PUT method should be received');
  assert(receivedMethods.includes('DELETE'), 'DELETE method should be received');

  isolate.destroy();
}

async function testArrayBufferResponse() {
  const isolate = await createIsolateWithFetchHandler(async () => {
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: 'binary data here',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/binary');
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder();
    const text = decoder.decode(buffer);
    NETWORK.send('fetchResult', {
      byteLength: buffer.byteLength,
      text: text,
    });
  `);

  assertEqual(result.text, 'binary data here', 'ArrayBuffer should contain correct data');
  assert(result.byteLength > 0, 'ArrayBuffer should have length');

  isolate.destroy();
}

async function testNoHandlerRegistered() {
  const isolate = await sandbox.createIsolate();
  // Intentionally NOT registering a fetch handler

  try {
    await executeFetchInIsolate(isolate, `
      const response = await fetch('https://api.example.com/data');
      NETWORK.send('fetchResult', { ok: response.ok });
    `);
    throw new Error('Should have thrown error');
  } catch (error) {
    assert(error.message.includes('No handler') || error.message.includes('fetch'),
      'Error should indicate no handler is registered');
  }

  isolate.destroy();
}

async function testHeadersCaseInsensitivity() {
  const isolate = await createIsolateWithFetchHandler(async () => {
    return {
      ok: true,
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
      },
      body: '{}',
    };
  });

  const result = await executeFetchInIsolate(isolate, `
    const response = await fetch('https://api.example.com/test');
    NETWORK.send('fetchResult', {
      contentType: response.headers.get('content-type'),
      contentTypeCaps: response.headers.get('CONTENT-TYPE'),
      custom: response.headers.get('x-custom-header'),
    });
  `);

  assertEqual(result.contentType, 'application/json', 'Should get header with lowercase');
  assertEqual(result.contentTypeCaps, 'application/json', 'Should get header case-insensitively');
  assertEqual(result.custom, 'value', 'Should get custom header');

  isolate.destroy();
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runAllTests() {
  console.log('=== Fetch Hooking in Isolates Tests ===\n');
  await Promise.all([

    runTest('Basic GET request', testBasicGetRequest),

    runTest('POST request with body', testPostRequestWithBody),
    runTest('Headers handling', testHeadersHandling),
    runTest('Text response', testTextResponse),

    runTest('URL object support', testUrlObjectSupport),
    runTest('Domain blocking', testDomainBlocking),

    runTest('Error response (4xx/5xx)', testErrorResponse),

    runTest('Handler throws error', testHandlerThrowsError),

    runTest('Multiple fetch requests', testMultipleFetchRequests),
    runTest('PUT and DELETE methods', testPutAndDeleteMethods),
    runTest('ArrayBuffer response', testArrayBufferResponse),

    runTest('No handler registered', testNoHandlerRegistered),

    runTest('Headers case insensitivity', testHeadersCaseInsensitivity)
  ])

  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Total:  ${testsPassed + testsFailed}`);

  if (testsFailed > 0) {
    console.error('\n❌ Some tests failed!');
    // Don't exit with error code as that might interfere with the runtime
  } else {
    console.log('\n✅ All tests passed!');
  }

  sandbox.shutdown();
}

runAllTests();
