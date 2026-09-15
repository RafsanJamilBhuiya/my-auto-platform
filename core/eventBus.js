/**
 * OmniFlow Core - Event Bus System
 * 
 * A robust, production-grade event/hook system using Node.js EventEmitter.
 * Provides safe plugin registration with error handling and isolation.
 * 
 * Features:
 * - Action hooks: Plugins can register and execute sequential actions
 * - Filter hooks: Plugins can register and apply sequential filters to data
 * - Safe event listening: Error handling prevents plugin crashes from affecting core
 * - Event priorities: Support for hook priorities (higher = earlier execution)
 */

const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.actions = new Map();
    this.filters = new Map();
    this.hookPriorities = new Map();
    this.errorHandlers = new Set();
    
    // Set max listeners to prevent memory leak warnings
    this.setMaxListeners(100);
    
    // Configure error handling
    this.on('error', this._handleError.bind(this));
  }

  /**
   * Register an action hook
   * Actions are executed sequentially without modifying data
   * 
   * @param {string} hookName - The name of the hook
   * @param {Function} callback - The callback function to execute
   * @param {number} priority - Execution priority (default: 10, higher = earlier)
   * @param {string} pluginName - The name of the plugin registering the hook
   * @returns {Function} Unregister function
   */
  registerAction(hookName, callback, priority = 10, pluginName = 'unknown') {
    if (typeof hookName !== 'string') {
      throw new Error('Hook name must be a string');
    }
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const hookKey = `action:${hookName}`;
    
    if (!this.actions.has(hookKey)) {
      this.actions.set(hookKey, []);
      this.hookPriorities.set(hookKey, []);
    }

    const hookData = {
      callback,
      priority,
      pluginName,
      registered: new Date()
    };

    const hooks = this.actions.get(hookKey);
    const priorities = this.hookPriorities.get(hookKey);
    
    hooks.push(hookData);
    priorities.push(priority);

    // Sort by priority (higher first)
    const indices = hooks.map((_, i) => i);
    indices.sort((a, b) => priorities[b] - priorities[a]);
    
    const sortedHooks = indices.map(i => hooks[i]);
    const sortedPriorities = indices.map(i => priorities[i]);
    
    this.actions.set(hookKey, sortedHooks);
    this.hookPriorities.set(hookKey, sortedPriorities);

    // Return unregister function
    return () => {
      const index = this.actions.get(hookKey).indexOf(hookData);
      if (index > -1) {
        this.actions.get(hookKey).splice(index, 1);
        this.hookPriorities.get(hookKey).splice(index, 1);
      }
    };
  }

  /**
   * Execute all registered actions for a hook
   * Errors in one action don't prevent others from executing
   * 
   * @param {string} hookName - The name of the hook
   * @param {...any} args - Arguments to pass to callbacks
   * @returns {Promise<void>}
   */
  async executeAction(hookName, ...args) {
    const hookKey = `action:${hookName}`;
    const hooks = this.actions.get(hookKey) || [];

    for (const hookData of hooks) {
      try {
        await Promise.resolve(hookData.callback(...args));
      } catch (error) {
        this._emitError({
          type: 'ACTION_ERROR',
          hookName,
          pluginName: hookData.pluginName,
          error
        });
      }
    }
  }

  /**
   * Register a filter hook
   * Filters modify data and pass it through a chain of callbacks
   * 
   * @param {string} hookName - The name of the hook
   * @param {Function} callback - The callback function (must return modified value)
   * @param {number} priority - Execution priority (default: 10, higher = earlier)
   * @param {string} pluginName - The name of the plugin registering the hook
   * @returns {Function} Unregister function
   */
  registerFilter(hookName, callback, priority = 10, pluginName = 'unknown') {
    if (typeof hookName !== 'string') {
      throw new Error('Hook name must be a string');
    }
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const hookKey = `filter:${hookName}`;
    
    if (!this.filters.has(hookKey)) {
      this.filters.set(hookKey, []);
      this.hookPriorities.set(hookKey, []);
    }

    const hookData = {
      callback,
      priority,
      pluginName,
      registered: new Date()
    };

    const hooks = this.filters.get(hookKey);
    const priorities = this.hookPriorities.get(hookKey);
    
    hooks.push(hookData);
    priorities.push(priority);

    // Sort by priority (higher first)
    const indices = hooks.map((_, i) => i);
    indices.sort((a, b) => priorities[b] - priorities[a]);
    
    const sortedHooks = indices.map(i => hooks[i]);
    const sortedPriorities = indices.map(i => priorities[i]);
    
    this.filters.set(hookKey, sortedHooks);
    this.hookPriorities.set(hookKey, sortedPriorities);

    // Return unregister function
    return () => {
      const index = this.filters.get(hookKey).indexOf(hookData);
      if (index > -1) {
        this.filters.get(hookKey).splice(index, 1);
        this.hookPriorities.get(hookKey).splice(index, 1);
      }
    };
  }

  /**
   * Apply all registered filters to data
   * Each filter receives the output of the previous filter
   * 
   * @param {string} hookName - The name of the hook
   * @param {any} value - The initial value to filter
   * @param {...any} args - Additional arguments to pass to callbacks
   * @returns {Promise<any>} The filtered value
   */
  async applyFilter(hookName, value, ...args) {
    const hookKey = `filter:${hookName}`;
    const hooks = this.filters.get(hookKey) || [];

    let result = value;

    for (const hookData of hooks) {
      try {
        result = await Promise.resolve(hookData.callback(result, ...args));
      } catch (error) {
        this._emitError({
          type: 'FILTER_ERROR',
          hookName,
          pluginName: hookData.pluginName,
          error
        });
        // Continue with previous value on error
      }
    }

    return result;
  }

  /**
   * Register an error handler
   * @param {Function} handler - Function to handle errors
   */
  onError(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Error handler must be a function');
    }
    this.errorHandlers.add(handler);
  }

  /**
   * Get all registered hooks for debugging
   * @returns {Object} Object containing all registered hooks
   */
  getHooks() {
    const hooks = {
      actions: {},
      filters: {}
    };

    for (const [key, values] of this.actions.entries()) {
      hooks.actions[key] = values.map(h => ({
        pluginName: h.pluginName,
        priority: h.priority,
        registered: h.registered
      }));
    }

    for (const [key, values] of this.filters.entries()) {
      hooks.filters[key] = values.map(h => ({
        pluginName: h.pluginName,
        priority: h.priority,
        registered: h.registered
      }));
    }

    return hooks;
  }

  /**
   * Clear all hooks (use with caution)
   */
  clearAllHooks() {
    this.actions.clear();
    this.filters.clear();
    this.hookPriorities.clear();
  }

  /**
   * Internal: Handle errors safely
   * @private
   */
  _emitError(errorData) {
    const error = new Error(
      `${errorData.type}: Hook '${errorData.hookName}' in plugin '${errorData.pluginName}': ${errorData.error.message}`
    );
    error.originalError = errorData.error;

    for (const handler of this.errorHandlers) {
      try {
        handler(error, errorData);
      } catch (e) {
        console.error('Error in error handler:', e);
      }
    }

    if (this.errorHandlers.size === 0) {
      console.error('[EventBus Error]', error.message);
    }
  }

  /**
   * Internal: Handle EventEmitter errors
   * @private
   */
  _handleError(error) {
    console.error('[EventBus Fatal Error]', error);
  }
}

// Export singleton instance
module.exports = new EventBus();
