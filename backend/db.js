const { Pool } = require('pg');
const config = require('./config/config');

const pool = new Pool({
    user: config.database.user,
    host: config.database.host,
    database: config.database.name,
    password: config.database.password,
    port: config.database.port,
    max: config.database.maxConnections,
    ssl: config.database.ssl
});

// Test connection
pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Database connection error:', err);
});

// Helper function for queries
const query = (text, params) => pool.query(text, params);

// Helper function for transactions
const transaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Initialize database tables if they don't exist
const initializeDatabase = async () => {
    try {
        // Check if tables exist, create if not
        const tablesQuery = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('doctors', 'patients', 'appointments', 'symptom_rules', 'chat_sessions', 'chat_interactions');
        `;
        
        const result = await query(tablesQuery);
        
        if (result.rows.length === 0) {
            console.log('Initializing database tables...');
            // Read and execute schema file would go here
            // For now, assume tables are created manually
        }

        // Lightweight migrations to ensure required columns exist
        const migrations = [
            // chat_sessions safety columns
            "ALTER TABLE IF EXISTS chat_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
            "ALTER TABLE IF EXISTS chat_sessions ADD COLUMN IF NOT EXISTS summary TEXT",
            "ALTER TABLE IF EXISTS chat_sessions ADD COLUMN IF NOT EXISTS ai_diagnosis_hints TEXT",
            "ALTER TABLE IF EXISTS chat_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'",
            // appointments safety columns used by code
            "ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS ai_diagnosis_hints TEXT",
            "ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS chat_summary TEXT",
            // doctors safety columns for booking flow
            "ALTER TABLE IF EXISTS doctors ADD COLUMN IF NOT EXISTS booked_slots JSONB DEFAULT '[]'"
        ];

        for (const stmt of migrations) {
            try {
                await query(stmt);
            } catch (e) {
                // Log and continue to avoid blocking startup
                console.warn('Migration step skipped/failed:', stmt, e.message);
            }
        }
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
};

// Call initialization
initializeDatabase();

module.exports = {
    query,
    transaction,
    pool
};