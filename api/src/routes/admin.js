/**
 * routes/admin.js  — all routes require master_admin role
 *
 * GET    /api/admin/users                 list all users + role
 * POST   /api/admin/users                 create user (replaces admin-create-user edge fn)
 * DELETE /api/admin/users/:id             delete user (replaces admin-delete-user edge fn)
 *
 * GET    /api/admin/developments          all developments
 * GET    /api/admin/units                 all units (optionally ?development_id=)
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const db                           = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router    = express.Router();
const adminOnly = [requireAuth, requireRole('master_admin')];

// =================================================================
// USERS
// =================================================================

// GET /api/admin/users
router.get('/users', ...adminOnly, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.country, u.created_at,
              COALESCE(r.role, 'user') AS role
       FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users   (replaces admin-create-user edge function)
router.post('/users', ...adminOnly, async (req, res, next) => {
  try {
    const { email, password, full_name, phone, country, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password are required' });
    }
    if (!['user', 'master_admin'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      return res.status(409).json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const id   = uuidv4();

    await db.query(
      'INSERT INTO users (id, email, password_hash, full_name, phone, country) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, hash, full_name || null, phone || null, country || null]
    );
    await db.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [id, role]);

    res.status(201).json({ ok: true, user: { id, email, full_name, role } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id   (replaces admin-delete-user edge function)
router.delete('/users/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'Cannot delete your own account' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (!existing.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Cascade FK handles user_roles deletion
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', ...adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!['user', 'master_admin'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'Cannot change your own role' });
    }
    await db.query(
      'INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON DUPLICATE KEY UPDATE role = ?',
      [id, role, role]
    );
    res.json({ ok: true, role });
  } catch (err) {
    next(err);
  }
});

// =================================================================
// DEVELOPMENTS  (admin view — same data, explicit admin route)
// =================================================================

router.get('/developments', ...adminOnly, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, u.email AS created_by_email
       FROM developments d
       LEFT JOIN users u ON u.id = d.created_by
       ORDER BY d.created_at DESC`
    );
    res.json({ developments: rows });
  } catch (err) {
    next(err);
  }
});

// =================================================================
// UNITS  (admin view)
// =================================================================

router.get('/units', ...adminOnly, async (req, res, next) => {
  try {
    const { development_id } = req.query;
    let sql    = `SELECT u.*, d.name AS development_name
                  FROM units u
                  LEFT JOIN developments d ON d.id = u.development_id`;
    const args = [];
    if (development_id) {
      sql += ' WHERE u.development_id = ?';
      args.push(development_id);
    }
    sql += ' ORDER BY u.created_at DESC';
    const [rows] = await db.query(sql, args);
    res.json({ units: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
