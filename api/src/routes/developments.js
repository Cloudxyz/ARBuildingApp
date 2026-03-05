/**
 * routes/developments.js
 *
 * GET    /api/developments
 * GET    /api/developments/:id
 * POST   /api/developments
 * PUT    /api/developments/:id
 * DELETE /api/developments/:id
 */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const db                           = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM developments ORDER BY created_at DESC');
    res.json({ developments: rows });
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM developments WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Development not found' });
    res.json({ development: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, type, description, address, city, state, country } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO developments (id, user_id, name, type, description, address, city, state, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, name, type || 'fraccionamiento',
       description || null, address || null, city || null, state || null, country || null]
    );
    const [rows] = await db.query('SELECT * FROM developments WHERE id = ?', [id]);
    res.status(201).json({ development: rows[0] });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT id FROM developments WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Development not found' });
    const { name, type, description, address, city, state, country } = req.body;
    await db.query(
      `UPDATE developments SET name=?, type=?, description=?, address=?, city=?, state=?, country=? WHERE id=?`,
      [name, type || 'fraccionamiento', description || null,
       address || null, city || null, state || null, country || null, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM developments WHERE id = ?', [req.params.id]);
    res.json({ development: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, requireRole('master_admin'), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT id FROM developments WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Development not found' });
    await db.query('DELETE FROM developments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
