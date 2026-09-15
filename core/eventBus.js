/**
 * Core Event Bus
 *
 * A fault-tolerant EventEmitter-based action/filter system for plugins.
 * Plugin failures are isolated and reported; they never propagate into the
 * core application lifecycle.
 */
const { EventEmitter } = require('node:events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.actions = new Map();
    this.filters = new Map();
    this.errorHandlers = new Set();
  }

  registerAction(name, handler, priority = 10, pluginName = 'unknown') {
    this.#validate(name, handler, priority);
    const entry = { handler, priority, pluginName };
    const hooks = this.actions.get(name) || [];
    hooks.push(entry);
    hooks.sort((a, b) => b.priority - a.priority);
    this.actions.set(name, hooks);
    return () => this.#remove(this.actions, name, entry);
  }

  registerFilter(name, handler, priority = 10, pluginName = 'unknown') {
    this.#validate(name, handler, priority);
    const entry = { handler, priority, pluginName };
    const hooks = this.filters.get(name) || [];
    hooks.push(entry);
    hooks.sort((a, b) => b.priority - a.priority);
    this.filters.set(name, hooks);
    return () => this.#remove(this.filters, name, entry);
  }

  async executeAction(name, ...args) {
    for (const entry of [...(this.actions.get(name) || [])]) {
      try {
        await entry.handler(...args);
      } catch (error) {
        this.#report(error, { type: 'ACTION_ERROR', name, pluginName: entry.pluginName });
      }
    }
  }

  async applyFilter(name, value, ...args) {
    let result = value;
    for (const entry of [...(this.filters.get(name) || [])]) {
      try {
        result = await entry.handler(result, ...args);
      } catch (error) {
        this.#report(error, { type: 'FILTER_ERROR', name, pluginName: entry.pluginName });
      }
    }
    return result;
  }

  onError(handler) {
    if (typeof handler !== 'function') throw new TypeError('Error handler must be a function');
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  removePluginHooks(pluginName) {
    for (const registry of [this.actions, this.filters]) {
      for (const [name, hooks] of registry) {
        const remaining = hooks.filter((entry) => entry.pluginName !== pluginName);
        remaining.length ? registry.set(name, remaining) : registry.delete(name);
      }
    }
  }

  getHooks() {
    const serialize = (registry) => Object.fromEntries(
      [...registry].map(([name, hooks]) => [name, hooks.map(({ pluginName, priority }) => ({ pluginName, priority }))])
    );
    return { actions: serialize(this.actions), filters: serialize(this.filters) };
  }

  #validate(name, handler, priority) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Hook name must be a non-empty string');
    if (typeof handler !== 'function') throw new TypeError('Hook handler must be a function');
    if (!Number.isFinite(priority)) throw new TypeError('Hook priority must be a finite number');
  }

  #remove(registry, name, entry) {
    const hooks = registry.get(name);
    if (!hooks) return;
    const remaining = hooks.filter((candidate) => candidate !== entry);
    remaining.length ? registry.set(name, remaining) : registry.delete(name);
  }

  #report(error, context) {
    const payload = { ...context, error, timestamp: new Date().toISOString() };
    if (!this.errorHandlers.size) {
      console.error(`[EventBus] ${context.type} in ${context.pluginName}:`, error.message);
      return;
    }
    for (const handler of this.errorHandlers) {
      try { handler(error, payload); } catch (handlerError) {
        console.error('[EventBus] Error handler failed:', handlerError.message);
      }
    }
  }
}

module.exports = new EventBus();
