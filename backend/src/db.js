const { Pool } = require('pg');
require('dotenv').config();

// Configuración de la conexión utilizando variables de entorno
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/kinetix',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('[PostgreSQL] Conexión establecida con la base de datos');
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Error inesperado en el pool de conexiones:', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
