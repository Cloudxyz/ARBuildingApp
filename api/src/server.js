/**
 * server.js — Express entry point
 */
'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes        = require('./routes/auth');
const developmentRoutes = require('./routes/developments');
const unitRoutes        = require('./routes/units');
const uploadRoutes      = require('./routes/uploads');
const adminRoutes       = require('./routes/admin');

const app  = express();
const PORT = parseInt(process.env.API_PORT || '3002', 10);

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve uploaded files as static assets
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadDir));

// ── Routes ──────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/developments', developmentRoutes);
app.use('/api',              unitRoutes);       // /api/units + /api/unit-*
app.use('/api/uploads',      uploadRoutes);
app.use('/api/admin',        adminRoutes);

// ── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── DB diagnostic — shows actual columns in units table ──────────
app.get('/api/debug/schema', async (_req, res) => {
  try {
    const db = require('./db');
    const [cols] = await db.query('SHOW COLUMNS FROM units');
    const [glbCols] = await db.query('SHOW COLUMNS FROM unit_glb_models').catch(() => [[]]);
    const [utCols]  = await db.query('SHOW COLUMNS FROM unit_type_models').catch(() => [[]]);
    res.json({
      units: cols.map(c => ({ field: c.Field, type: c.Type, default: c.Default })),
      unit_glb_models: glbCols.map(c => ({ field: c.Field, type: c.Type })),
      unit_type_models: utCols.map(c => ({ field: c.Field, type: c.Type })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 404 ─────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
