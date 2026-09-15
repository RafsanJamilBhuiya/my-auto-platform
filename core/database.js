/**
 * OmniFlow Core - Database Module
 * 
 * Initializes and exports a Supabase client for database operations.
 * Handles authentication, connection management, and error handling.
 * 
 * Features:
 * - Lazy initialization on first use
 * - Environment-based configuration
 * - Error handling and validation
 * - Health check capabilities
 */

const { createClient } = require('@supabase/supabase-js');

class Database {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.connectionError = null;
  }

  /**
   * Initialize the Supabase client
   * Validates environment variables and establishes connection
   * 
   * @returns {Promise<Object>} The initialized Supabase client
   * @throws {Error} If required environment variables are missing
   */
  async initialize() {
    if (this.initialized) {
      return this.client;
    }

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

      // Validate required environment variables
      if (!supabaseUrl) {
        throw new Error(
          'SUPABASE_URL environment variable is not defined. ' +
          'Please set it in your .env file'
        );
      }

      if (!supabaseAnonKey) {
        throw new Error(
          'SUPABASE_ANON_KEY environment variable is not defined. ' +
          'Please set it in your .env file'
        );
      }

      // Validate URL format
      if (!supabaseUrl.startsWith('https://')) {
        throw new Error(
          'SUPABASE_URL must start with https://'
        );
      }

      // Create Supabase client
      this.client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: false,
          detectSessionInUrl: false
        }
      });

      // Attempt a health check
      const { data, error } = await this.client
        .from('information_schema.tables')
        .select('table_name')
        .limit(1);

      if (error && error.code !== 'PGRST201') {
        // PGRST201 is not-found, which is ok for this check
        console.warn('[Database] Warning during health check:', error.message);
      }

      this.initialized = true;
      this.connectionError = null;

      console.log('[Database] Successfully initialized Supabase client');
      return this.client;
    } catch (error) {
      this.connectionError = error;
      console.error('[Database] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Get the Supabase client (lazy initialization on first access)
   * 
   * @returns {Object} The Supabase client
   * @throws {Error} If initialization has previously failed
   */
  getClient() {
    if (!this.initialized && this.connectionError) {
      throw this.connectionError;
    }

    if (!this.client) {
      throw new Error(
        'Database client not initialized. Call initialize() first.'
      );
    }

    return this.client;
  }

  /**
   * Check database connection health
   * 
   * @returns {Promise<Object>} Health status object
   */
  async healthCheck() {
    try {
      if (!this.initialized) {
        return {
          status: 'not_initialized',
          healthy: false
        };
      }

      const { error } = await this.client
        .from('information_schema.tables')
        .select('table_name')
        .limit(1);

      return {
        status: error ? 'error' : 'connected',
        healthy: !error,
        error: error?.message || null,
        connectedAt: new Date()
      };
    } catch (error) {
      return {
        status: 'error',
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Get database statistics
   * 
   * @returns {Promise<Object>} Database statistics
   */
  async getStats() {
    try {
      if (!this.initialized) {
        return null;
      }

      const { data: tables } = await this.client
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

      return {
        tablesCount: tables?.length || 0,
        tables: tables?.map(t => t.table_name) || [],
        initialized: this.initialized
      };
    } catch (error) {
      console.error('[Database] Error fetching stats:', error.message);
      return null;
    }
  }

  /**
   * Execute a raw query (use with caution)
   * 
   * @param {string} query - The SQL query
   * @returns {Promise<Object>} Query result
   */
  async query(query) {
    if (!this.initialized) {
      throw new Error('Database not initialized');
    }

    try {
      const { data, error } = await this.client.rpc('execute_query', {
        query
      }).catch(() => {
        // Fallback if rpc function doesn't exist
        return { data: null, error: new Error('RPC function not available') };
      });

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[Database] Query execution failed:', error.message);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new Database();
