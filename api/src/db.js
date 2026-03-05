/**
 * db.js — mysql2 connection pool
 * Uses env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  database:           process.env.DB_NAME     || 'realestatear',
  user:               process.env.DB_USER     || 'realestatear-user',
  password:           process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+00:00',
  charset:            'utf8mb4',
  // Auto-parse JSON columns (e.g. units.floors) so they return as JS arrays/objects
  typeCast(field, next) {
    if (field.type === 'JSON') {
      const raw = field.string();
      if (raw === null || raw === undefined) return null;
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return next();
  },
});

// Verify connectivity on startup
pool.getConnection()
  .then(conn => {
    console.log('[db] MySQL connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('[db] MySQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;
