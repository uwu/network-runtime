// Bootstrap script for the main isolate
// Provides the V8Sandbox API for managing worker isolates

const core = globalThis.Deno.core;
const ops = core.ops;

/**
 * Global event dispatcher for all isolates
 * Uses event-driven message reception instead of polling
 */
class GlobalEventDispatcher {
  #isolates = new Map(); // Map of isolate_id -> Isolate instance
  #messageLoopRunning = false;
  #systemEventLoopRunning = false;

  constructor() {
    // Don't start loops in constructor - will be started lazily on first isolate
  }

  register(isolate) {
    this.#isolates.set(isolate.id, isolate);

    // Start loops lazily when first isolate is registered
    if (!this.#messageLoopRunning) {
      this.#startMessageLoop();
    }
    if (!this.#systemEventLoopRunning) {
      this.#startSystemEventLoop();
    }
  }

  unregister(isolateId) {
    this.#isolates.delete(isolateId);
  }

  async #startMessageLoop() {
    if (this.#messageLoopRunning) return;
    this.#messageLoopRunning = true;

    // Continuously wait for messages from any isolate
    // op_sandbox_poll_messages blocks until a message arrives
    while (this.#messageLoopRunning) {
      try {
        // This blocks until at least one message arrives - no polling needed!
        const messages = await ops.op_sandbox_poll_messages();
        for (const msg of messages) {
          const isolate = this.#isolates.get(msg.isolate_id);
          if (isolate && !isolate.destroyed) {
            isolate._dispatchEvent(msg.event, msg.data);
          }
        }
      } catch (e) {
        console.error("Error in message loop:", e);
      }
    }
  }

  async #startSystemEventLoop() {
    if (this.#systemEventLoopRunning) return;
    this.#systemEventLoopRunning = true;

    // Continuously wait for system events
    while (this.#systemEventLoopRunning) {
      try {
        // This blocks until events arrive, no polling needed
        const events = await ops.op_sandbox_poll_system_events();
        for (const event of events) {
          const isolate = this.#isolates.get(event.isolate_id);
          if (isolate) {
            isolate._dispatchSystemEvent(event.event_type, event.data);
          }
        }
      } catch (e) {
        console.error("Error in system event loop:", e);
      }
    }
  }
}

// Create global dispatcher
const globalDispatcher = new GlobalEventDispatcher();

/**
 * Isolate class - represents a single worker isolate
 */
class Isolate {
  #id;
  #destroyed = false;
  #eventHandlers = new Map();
  #systemEventHandlers = new Map();
  #requestHandlers = new Map();

  /**
   * @param {number} id - The isolate ID
   * @private
   */
  constructor(id) {
    this.#id = id;
    globalDispatcher.register(this);
  }

  /**
   * Get the isolate ID
   * @returns {number} The isolate ID
   */
  get id() {
    return this.#id;
  }

  /**
   * Check if the isolate has been destroyed
   * @returns {boolean} True if destroyed
   */
  get destroyed() {
    return this.#destroyed;
  }

  /**
   * Dispatch a user event (called by global dispatcher)
   * @private
   */
  _dispatchEvent(event, data) {
    // Handle request/response messages
    if (event === '__request') {
      const { requestId, method, data: requestData } = data;
      const handler = this.#requestHandlers.get(method);

      if (handler) {
        // Call handler and send response
        Promise.resolve(handler(requestData))
          .then(result => {
            this.send('__response', { requestId, result });
          })
          .catch(error => {
            this.send('__response', { requestId, error: error.message });
          });
      } else {
        // No handler registered
        this.send('__response', {
          requestId,
          error: `No handler registered for method: ${method}`
        });
      }
      return;
    }

    // Normal event handling
    const handlers = this.#eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          console.error(`Error in event handler for '${event}':`, e);
        }
      }
    }
  }

  /**
   * Dispatch a system event (called by global dispatcher)
   * @private
   */
  _dispatchSystemEvent(eventType, data) {
    const handlers = this.#systemEventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          console.error(`Error in system event handler for '${eventType}':`, e);
        }
      }
    }
  }

  /**
   * Register an event handler for messages from this isolate
   * @param {string} event - The event name
   * @param {Function} handler - The event handler function
   * @returns {Isolate} This isolate (for chaining)
   */
  on(event, handler) {
    if (this.#destroyed) {
      throw new Error(`Cannot register handler on destroyed isolate #${this.#id}`);
    }
    if (!this.#eventHandlers.has(event)) {
      this.#eventHandlers.set(event, []);
    }
    this.#eventHandlers.get(event).push(handler);
    return this;
  }

  /**
   * Register a system event handler (secure events from Rust)
   * @param {string} eventType - The system event type (e.g., "terminated", "destroyed")
   * @param {Function} handler - The event handler function
   * @returns {Isolate} This isolate (for chaining)
   */
  onSystem(eventType, handler) {
    if (this.#destroyed) {
      throw new Error(`Cannot register handler on destroyed isolate #${this.#id}`);
    }
    if (!this.#systemEventHandlers.has(eventType)) {
      this.#systemEventHandlers.set(eventType, []);
    }
    this.#systemEventHandlers.get(eventType).push(handler);
    return this;
  }

  /**
   * Register a request handler (for async request/response from worker)
   * @param {string} method - The method name
   * @param {Function} handler - The handler function (can be async)
   * @returns {Isolate} This isolate (for chaining)
   */
  onRequest(method, handler) {
    if (this.#destroyed) {
      throw new Error(`Cannot register handler on destroyed isolate #${this.#id}`);
    }
    this.#requestHandlers.set(method, handler);
    return this;
  }

  /**
   * Remove an event handler
   * @param {string} event - The event name
   * @param {Function} handler - The handler to remove
   * @returns {Isolate} This isolate (for chaining)
   */
  off(event, handler) {
    const handlers = this.#eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Send a message to this isolate
   * @param {string} event - The event name
   * @param {*} data - The data to send (must be JSON-serializable)
   * @throws {Error} If the isolate has been destroyed
   */
  send(event, data) {
    if (this.#destroyed) {
      throw new Error(`Cannot send to destroyed isolate #${this.#id}`);
    }
    // Send via channel - this is non-blocking and processed within the worker's event loop
    // This fixes the deadlock that occurred when using op_sandbox_execute
    ops.op_sandbox_send_to_isolate(this.#id, event, data);
  }

  /**
   * Execute JavaScript code in this isolate
   * @param {string} script - JavaScript code to execute
   * @throws {Error} If the isolate has been destroyed
   */
  execute(script) {
    if (this.#destroyed) {
      throw new Error(`Cannot execute on destroyed isolate #${this.#id}`);
    }
    ops.op_sandbox_execute(this.#id, script);
  }

  /**
   * Destroy this isolate
   * @throws {Error} If the isolate has already been destroyed
   */
  destroy() {
    if (this.#destroyed) {
      throw new Error(`Isolate #${this.#id} has already been destroyed`);
    }
    // Call destroy op first so the "destroyed" system event can still be delivered
    ops.op_sandbox_destroy_isolate(this.#id);
    this.#destroyed = true;
    // Don't unregister from dispatcher yet - let system events be delivered
    // The destroyed flag will prevent any new operations
    // Clear user event handlers but keep system event handlers for the "destroyed" event
    this.#eventHandlers.clear();
  }

  /**
   * String representation of the isolate
   * @returns {string}
   */
  toString() {
    return `Isolate #${this.#id}${this.#destroyed ? ' (destroyed)' : ''}`;
  }
}

/**
 * V8Sandbox class - manages worker isolates from the main isolate
 */
class V8Sandbox {
  /**
   * Create a new isolate
   * @returns {Promise<Isolate>} The created isolate instance
   */
  async createIsolate() {
    const id = await ops.op_sandbox_create_isolate();
    return new Isolate(id);
  }

  /**
   * Get the number of worker threads
   * @returns {number} Number of worker threads
   */
  threadCount() {
    return ops.op_sandbox_thread_count();
  }

  /**
   * Get the number of active isolates
   * @returns {number} Number of active isolates
   */
  isolateCount() {
    return ops.op_sandbox_isolate_count();
  }

  /**
   * Shutdown the sandbox
   */
  shutdown() {
    ops.op_sandbox_shutdown();
  }
}

// Export classes to globalThis so user scripts can access them
globalThis.V8Sandbox = V8Sandbox;
globalThis.Isolate = Isolate;
