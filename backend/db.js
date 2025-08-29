const { Pool } = require('pg');

console.log('--- [DB DEBUG] Forcing SSL connection for debugging ---');
console.log(`--- [DB DEBUG] Connecting with DATABASE_URL: ${process.env.DATABASE_URL ? 'Exists' : 'MISSING!'}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // NO conditional logic. We are forcing this configuration.
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};