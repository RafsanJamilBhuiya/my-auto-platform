/**
 * Advanced plugin loader.
 *
 * Plugins are discovered from ./plugins and must contain a manifest.json and
 * index.js. Module execution is wrapped in a restricted VM context with a
 * deny-by-default require() function. This is a defense-in-depth boundary,
 * not a substitute for running untrusted plugins in a separate OS/container.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const eventBus = require('./eventBus');

class PluginLoader {
  constructor() {
    this.pluginsDir = path.resolve(__dirname, '..', 'plugins');
    this.plugins = new Map();
    this.errors = [];
  }

  async loadAllPlugins() {
    this.errors = [];
    if (!fs.existsSync(this.pluginsDir)) fs.mkdirSync(this.pluginsDir, { recursive: true });

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await this.loadPlugin(entry.name);
    }

    return this.getStats();
  }

  async loadPlugin(pluginName) {
    try {
      this.#assertPluginName(pluginName);
      if (this.plugins.has(pluginName)) return this.plugins.get(pluginName);

      const pluginPath = this.#safePluginPath(pluginName);
      const manifest = this.#readManifest(pluginPath, pluginName);
      if (manifest.enabled === false) return null;

      const modulePath = path.join(pluginPath, 'index.js');
      if (!fs.existsSync(modulePath)) throw new Error('Missing index.js');

      const plugin = this.#loadSandboxedModule(modulePath);
      if (!plugin || typeof plugin.activate !== 'function') {
        throw new Error('Plugin must export an activate(eventBus) function');
      }

      await plugin.activate(eventBus);
      const record = { name: pluginName, manifest, module: plugin, status: 'active', loadedAt: new Date().toISOString() };
      this.plugins.set(pluginName, record);
      console.log(`[PluginLoader] ✓ ${pluginName} activated`);
      return record;
    } catch (error) {
      this.errors.push({ plugin: pluginName, message: error.message });
      console.error(`[PluginLoader] ✗ ${pluginName}: ${error.message}`);
      return null;
    }
  }

  async unloadPlugin(pluginName) {
    const record = this.plugins.get(pluginName);
    if (!record) return false;
    try {
      if (typeof record.module.deactivate === 'function') await record.module.deactivate(eventBus);
    } catch (error) {
      this.errors.push({ plugin: pluginName, message: `deactivate: ${error.message}` });
    } finally {
      eventBus.removePluginHooks(pluginName);
      this.plugins.delete(pluginName);
    }
    return true;
  }

  getPlugin(pluginName) { return this.plugins.get(pluginName) || null; }

  getPlugins() {
    return Object.fromEntries([...this.plugins].map(([name, record]) => [name, {
      name: record.manifest.name,
      version: record.manifest.version,
      description: record.manifest.description,
      status: record.status,
      loadedAt: record.loadedAt
    }]));
  }

  getStats() {
    return {
      discovered: this.plugins.size + this.errors.length,
      loaded: this.plugins.size,
      failed: this.errors.length,
      active: this.plugins.size,
      errors: [...this.errors]
    };
  }

  #readManifest(pluginPath, pluginName) {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('Missing manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== pluginName || !/^\d+\.\d+\.\d+/.test(manifest.version || '')) {
      throw new Error('Manifest must contain matching name and a semantic version');
    }
    if (manifest.hooks && !Array.isArray(manifest.hooks)) throw new Error('Manifest hooks must be an array');
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      author: manifest.author || '',
      enabled: manifest.enabled !== false,
      hooks: manifest.hooks || []
    };
  }

  #loadSandboxedModule(modulePath) {
    const source = fs.readFileSync(modulePath, 'utf8');
    const module = { exports: {} };
    const sandbox = Object.freeze({
      console,
      Date,
      JSON,
      Math,
      Promise,
      setTimeout,
      clearTimeout,
      module,
      exports: module.exports,
      require: () => { throw new Error('Plugin require() is disabled by the loader sandbox'); }
    });
    const context = vm.createContext(sandbox, { name: path.basename(path.dirname(modulePath)) });
    const wrapped = `(function (module, exports, require) { 'use strict';\n${source}\n})`;
    const factory = new vm.Script(wrapped, { filename: modulePath }).runInContext(context, { timeout: 1000 });
    factory(module, module.exports, sandbox.require);
    return module.exports;
  }

  #assertPluginName(name) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('Invalid plugin directory name');
  }

  #safePluginPath(name) {
    const resolved = path.resolve(this.pluginsDir, name);
    if (path.dirname(resolved) !== this.pluginsDir) throw new Error('Plugin path escapes plugins directory');
    return resolved;
  }
}

module.exports = new PluginLoader();
