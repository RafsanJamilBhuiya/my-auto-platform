/**
 * Reference plugin used to verify the plugin lifecycle and event bus.
 */
module.exports = {
  async activate(eventBus) {
    eventBus.registerAction(
      'app:boot',
      async () => {
        console.log('[sample-plugin] ✓ app:boot hook executed successfully');
      },
      10,
      'sample-plugin'
    );
  },

  async deactivate() {
    console.log('[sample-plugin] deactivated');
  }
};
