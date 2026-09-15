/**
 * OmniFlow Sample Plugin
 * 
 * This is a complete, working example plugin that demonstrates:
 * - How to implement the activate/deactivate lifecycle
 * - How to register action and filter hooks
 * - How to interact with the event bus safely
 * - Professional error handling
 */

module.exports = {
  /**
   * Activate hook - called when plugin is loaded
   * Register all actions and filters here
   * 
   * @param {EventBus} eventBus - The event bus instance
   * @returns {Promise<void>}
   */
  async activate(eventBus) {
    console.log('[Sample Plugin] Activating...');

    try {
      // Register an action hook that runs when the app boots
      eventBus.registerAction(
        'app:boot',
        async (appContext) => {
          console.log(
            '[Sample Plugin] ✓ Application boot hook triggered!\n' +
            '  ℹ  This demonstrates successful plugin activation.\n' +
            '  ℹ  The plugin system is running safely and isolated.'
          );
        },
        15, // Higher priority = earlier execution
        'sample-plugin'
      );

      // Register a filter hook that processes request data
      eventBus.registerFilter(
        'request:process',
        async (requestData) => {
          // Add plugin metadata to request
          return {
            ...requestData,
            'x-sample-plugin': 'active',
            processedAt: new Date().toISOString()
          };
        },
        10,
        'sample-plugin'
      );

      // Register another action hook for demonstration
      eventBus.registerAction(
        'plugin:status',
        async () => {
          console.log('[Sample Plugin] Status check: All systems operational');
        },
        10,
        'sample-plugin'
      );

      console.log('[Sample Plugin] ✓ Successfully activated');
    } catch (error) {
      console.error('[Sample Plugin] Activation failed:', error.message);
      throw error; // Let the plugin loader handle it
    }
  },

  /**
   * Deactivate hook - called when plugin is unloaded
   * Clean up resources here
   * 
   * @returns {Promise<void>}
   */
  async deactivate() {
    console.log('[Sample Plugin] Deactivating...');
    
    try {
      // Perform cleanup operations
      // - Close connections
      // - Clear caches
      // - Remove event listeners
      
      console.log('[Sample Plugin] ✓ Successfully deactivated');
    } catch (error) {
      console.error('[Sample Plugin] Deactivation error:', error.message);
      throw error;
    }
  },

  /**
   * Get plugin information
   * @returns {Object}
   */
  getInfo() {
    return {
      name: 'Sample Plugin',
      version: '1.0.0',
      description: 'Demonstrates the OmniFlow plugin system',
      status: 'active'
    };
  }
};
