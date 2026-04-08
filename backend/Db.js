const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'ai_english_teacher',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  // Keep a small pool for a starter app
  max:              10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Verify the database connection on startup.
 */
async function connectDB() {
  const client = await pool.connect();
  const { rows } = await client.query('SELECT NOW() AS now');
  client.release();
  console.log(`✅  PostgreSQL connected — server time: ${rows[0].now}`);
}

module.exports = { pool, connectDB };