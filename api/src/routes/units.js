/**
 * routes/units.js
 *
 * Units:
 *   GET    /api/units                 ?development_id=
 *   GET    /api/units/:id
 *   POST   /api/units
 *   PUT    /api/units/:id
 *   DELETE /api/units/:id
 *
 * Unit model (one per unit):
 *   GET    /api/units/:id/model
 *   POST   /api/units/:id/model
 *   PUT    /api/unit-models/:modelId
 *
 * Unit GLB models (many per unit):
 *   GET    /api/units/:id/glb-models
 *   POST   /api/units/:id/glb-models
 *   PUT    /api/unit-glb-models/:modelId
 *   DELETE /api/unit-glb-models/:modelId
 *
 * Unit type models:
 *   GET    /api/unit-type-models         ?unit_type=
 *   POST   /api/unit-type-models
 *   PUT    /api/unit-type-models/:id
 *   DELETE /api/unit-type-models/:id
 */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const db                           = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// =================================================================
// Helpers
// =================================================================

/**
 * Ensure the `floors` field is always returned as an array (never a raw
 * JSON string). mysql2 returns TEXT/VARCHAR columns as strings, so we
 * must parse regardless of column type.
 */
function parseUnit(row) {
  if (!row) return row;
  if (typeof row.floors === 'string') {
    try { row.floors = JSON.parse(row.floors); } catch { row.floors = null; }
  }
  return row;
}

// =================================================================
// UNITS
// =================================================================

// GET /api/units
router.get('/units', requireAuth, async (req, res, next) => {
  try {
    const { development_id } = req.query;
    let sql    = 'SELECT * FROM units';
    const args = [];
    if (development_id) {
      sql += ' WHERE development_id = ?';
      args.push(development_id);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.query(sql, args);
    res.json({ units: rows.map(parseUnit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/units/:id
router.get('/units/:id', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM units WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' });
    res.json({ unit: parseUnit(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/units
router.post('/units', requireAuth, async (req, res, next) => {
  try {
    const {
      development_id, name, description, address, city, state, country,
      unit_type, model_glb_url, area_sqm, latitude, longitude,
      price, status, thumbnail_url, floors,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO units
        (id, user_id, development_id, name, description, address, city, state, country,
         unit_type, model_glb_url, area_sqm, latitude, longitude, price, status, thumbnail_url, floors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user.id, development_id || null, name,
        description || null, address || null, city || null, state || null, country || null,
        unit_type || 'land', model_glb_url || null,
        area_sqm ?? null, latitude ?? null, longitude ?? null,
        price ?? null, status || 'available', thumbnail_url || null,
        floors ? JSON.stringify(floors) : null,
      ]
    );

    const [rows] = await db.query('SELECT * FROM units WHERE id = ?', [id]);
    res.status(201).json({ unit: parseUnit(rows[0]) });
  } catch (err) { next(err); }
});

// PUT /api/units/:id
router.put('/units/:id', requireAuth, async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT id FROM units WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Unit not found' });

    const {
      name, description, address, city, state, country,
      unit_type, model_glb_url, area_sqm, latitude, longitude,
      price, status, thumbnail_url, floors,
    } = req.body;

    await db.query(
      `UPDATE units SET name=?, description=?, address=?, city=?, state=?, country=?,
       unit_type=?, model_glb_url=?, area_sqm=?, latitude=?, longitude=?,
       price=?, status=?, thumbnail_url=?, floors=? WHERE id=?`,
      [
        name, description || null, address || null, city || null, state || null, country || null,
        unit_type || 'land', model_glb_url || null,
        area_sqm ?? null, latitude ?? null, longitude ?? null,
        price ?? null, status || 'available', thumbnail_url || null,
        floors ? JSON.stringify(floors) : null,
        req.params.id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM units WHERE id = ?', [req.params.id]);
    res.json({ unit: parseUnit(rows[0]) });
  } catch (err) { next(err); }
});

// DELETE /api/units/:id
router.delete('/units/:id', requireAuth, requireRole('master_admin'), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT id FROM units WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Unit not found' });

    await db.query('DELETE FROM units WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =================================================================
// UNIT MODEL  (one per unit — blueprint/footprint mesh)
// =================================================================

// GET /api/units/:id/model
router.get('/units/:id/model', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM unit_models WHERE unit_id = ? LIMIT 1', [req.params.id]);
    res.json({ model: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/units/:id/model  (upsert)
router.post('/units/:id/model', requireAuth, async (req, res, next) => {
  try {
    const { glb_url, storage_path } = req.body;
    const [existing] = await db.query(
      'SELECT id FROM unit_models WHERE unit_id = ? LIMIT 1', [req.params.id]
    );
    if (existing.length) {
      await db.query(
        'UPDATE unit_models SET glb_url=?, storage_path=? WHERE unit_id=?',
        [glb_url || null, storage_path || null, req.params.id]
      );
    } else {
      await db.query(
        'INSERT INTO unit_models (id, unit_id, user_id, glb_url, storage_path) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), req.params.id, req.user.id, glb_url || null, storage_path || null]
      );
    }
    const [rows] = await db.query('SELECT * FROM unit_models WHERE unit_id = ?', [req.params.id]);
    res.json({ model: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/unit-models/:modelId
router.put('/unit-models/:modelId', requireAuth, async (req, res, next) => {
  try {
    const { glb_url, storage_path } = req.body;
    await db.query(
      'UPDATE unit_models SET glb_url=?, storage_path=? WHERE id=?',
      [glb_url || null, storage_path || null, req.params.modelId]
    );
    const [rows] = await db.query('SELECT * FROM unit_models WHERE id = ?', [req.params.modelId]);
    res.json({ model: rows[0] || null });
  } catch (err) { next(err); }
});

// =================================================================
// UNIT GLB MODELS  (many per unit)
// =================================================================

// GET /api/units/:id/glb-models
router.get('/units/:id/glb-models', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM unit_glb_models WHERE unit_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ glb_models: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/units/:id/glb-models  (upsert per unit_type)
router.post('/units/:id/glb-models', requireAuth, async (req, res, next) => {
  try {
    const { unit_type, glb_url, storage_path, external_glb_url } = req.body;
    const resolvedType = unit_type || 'land';
    // Nothing to save — return success without creating a record
    if (!glb_url && !external_glb_url) {
      return res.json({ glb_model: null });
    }

    // Upsert: one row per (unit_id, unit_type) — SELECT * so merge logic can read existing values
    const [existing] = await db.query(
      'SELECT * FROM unit_glb_models WHERE unit_id = ? AND unit_type = ? LIMIT 1',
      [req.params.id, resolvedType]
    );

    if (existing.length) {
      const row = existing[0];
      // Only overwrite fields that were explicitly sent in the request body.
      const mergedGlbUrl      = 'glb_url'          in req.body ? (glb_url          ?? null) : row.glb_url;
      const mergedStoragePath = 'storage_path'     in req.body ? (storage_path     ?? null) : row.storage_path;
      const mergedExtUrl      = 'external_glb_url' in req.body ? (external_glb_url ?? null) : row.external_glb_url;
      await db.query(
        'UPDATE unit_glb_models SET glb_url=?, storage_path=?, external_glb_url=? WHERE id=?',
        [mergedGlbUrl, mergedStoragePath, mergedExtUrl, row.id]
      );
      const [rows] = await db.query('SELECT * FROM unit_glb_models WHERE id = ?', [row.id]);
      return res.json({ glb_model: rows[0] });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO unit_glb_models (id, unit_id, user_id, unit_type, glb_url, storage_path, external_glb_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, req.user.id, resolvedType,
       glb_url || null, storage_path || null, external_glb_url || null]
    );
    const [rows] = await db.query('SELECT * FROM unit_glb_models WHERE id = ?', [id]);
    res.status(201).json({ glb_model: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/unit-glb-models/:modelId
router.put('/unit-glb-models/:modelId', requireAuth, async (req, res, next) => {
  try {
    const { glb_url, storage_path, external_glb_url } = req.body;
    const [existing] = await db.query('SELECT * FROM unit_glb_models WHERE id = ? LIMIT 1', [req.params.modelId]);
    if (!existing.length) return res.status(404).json({ error: 'GLB model not found' });
    const row = existing[0];
    const mergedGlbUrl      = 'glb_url'          in req.body ? (glb_url          ?? null) : row.glb_url;
    const mergedStoragePath = 'storage_path'     in req.body ? (storage_path     ?? null) : row.storage_path;
    const mergedExtUrl      = 'external_glb_url' in req.body ? (external_glb_url ?? null) : row.external_glb_url;
    await db.query(
      'UPDATE unit_glb_models SET glb_url=?, storage_path=?, external_glb_url=? WHERE id=?',
      [mergedGlbUrl, mergedStoragePath, mergedExtUrl, req.params.modelId]
    );
    const [rows] = await db.query('SELECT * FROM unit_glb_models WHERE id = ?', [req.params.modelId]);
    res.json({ glb_model: rows[0] || null });
  } catch (err) { next(err); }
});

// DELETE /api/unit-glb-models/:modelId
router.delete('/unit-glb-models/:modelId', requireAuth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM unit_glb_models WHERE id = ?', [req.params.modelId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =================================================================
// UNIT TYPE MODELS  (shared library)
// =================================================================

// GET /api/unit-type-models
router.get('/unit-type-models', requireAuth, async (req, res, next) => {
  try {
    const { unit_type } = req.query;
    let sql    = 'SELECT * FROM unit_type_models';
    const args = [];
    if (unit_type) {
      sql += ' WHERE unit_type = ?';
      args.push(unit_type);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.query(sql, args);
    res.json({ unit_type_models: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/unit-type-models  (upsert — one row per unit_type)
router.post('/unit-type-models', requireAuth, async (req, res, next) => {
  try {
    const { unit_type, model_glb_url, external_model_glb_url, storage_path } = req.body;
    if (!unit_type) return res.status(400).json({ error: 'unit_type is required' });

    // Upsert: if a row for this unit_type already exists, merge and update it
    const [existing] = await db.query(
      'SELECT * FROM unit_type_models WHERE unit_type = ? LIMIT 1', [unit_type]
    );
    if (existing.length) {
      const row = existing[0];
      // Only overwrite a field when it was explicitly included in the request body.
      // This prevents saving a manual URL from wiping the uploaded GLB and vice-versa.
      const mergedGlbUrl      = 'model_glb_url'          in req.body ? (model_glb_url          ?? null) : row.model_glb_url;
      const mergedExtUrl      = 'external_model_glb_url' in req.body ? (external_model_glb_url  ?? null) : row.external_model_glb_url;
      const mergedStoragePath = 'storage_path'           in req.body ? (storage_path            ?? null) : row.storage_path;

      await db.query(
        `UPDATE unit_type_models SET user_id=?, model_glb_url=?, external_model_glb_url=?, storage_path=?
         WHERE unit_type=?`,
        [req.user.id, mergedGlbUrl, mergedExtUrl, mergedStoragePath, unit_type]
      );
      const [rows] = await db.query('SELECT * FROM unit_type_models WHERE unit_type = ?', [unit_type]);
      return res.json({ unit_type_model: rows[0] });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO unit_type_models (id, user_id, unit_type, model_glb_url, external_model_glb_url, storage_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, unit_type, model_glb_url ?? null,
       external_model_glb_url ?? null, storage_path ?? null]
    );
    const [rows] = await db.query('SELECT * FROM unit_type_models WHERE id = ?', [id]);
    res.status(201).json({ unit_type_model: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/unit-type-models/:id
router.put('/unit-type-models/:id', requireAuth, async (req, res, next) => {
  try {
    const { model_glb_url, external_model_glb_url, storage_path } = req.body;
    const [existing] = await db.query('SELECT * FROM unit_type_models WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const row = existing[0];

    const mergedGlbUrl      = 'model_glb_url'          in req.body ? (model_glb_url          ?? null) : row.model_glb_url;
    const mergedExtUrl      = 'external_model_glb_url' in req.body ? (external_model_glb_url  ?? null) : row.external_model_glb_url;
    const mergedStoragePath = 'storage_path'           in req.body ? (storage_path            ?? null) : row.storage_path;

    await db.query(
      'UPDATE unit_type_models SET model_glb_url=?, external_model_glb_url=?, storage_path=? WHERE id=?',
      [mergedGlbUrl, mergedExtUrl, mergedStoragePath, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM unit_type_models WHERE id = ?', [req.params.id]);
    res.json({ unit_type_model: rows[0] || null });
  } catch (err) { next(err); }
});

// DELETE /api/unit-type-models/:id
router.delete('/unit-type-models/:id', requireAuth, requireRole('master_admin'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM unit_type_models WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
