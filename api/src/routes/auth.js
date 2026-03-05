/**
 * routes/auth.js
 *
 * POST /api/auth/register
 * POST /api/auth/login
 * GET  /api/auth/me        (requires token)
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const db             = require('../db');
const { requireAuth } = require('../middleware/auth');

const router  = express.Router();
const SECRET  = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// ── POST /api/auth/register ──────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, phone, country } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const id   = uuidv4();

    await db.query(
      'INSERT INTO users (id, email, password_hash, full_name, phone, country) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, hash, full_name || null, phone || null, country || null]
    );
    await db.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [id, 'user']);

    const token = jwt.sign({ sub: id, email, role: 'user' }, SECRET, { expiresIn: EXPIRES });
    res.status(201).json({ token, user: { id, email, full_name, role: 'user' } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.phone, u.country,
              COALESCE(r.role, 'user') AS role
       FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.email = ?
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      SECRET,
      { expiresIn: EXPIRES }
    );

    res.json({
      token,
      user: {
        id:        user.id,
        email:     user.email,
        full_name: user.full_name,
        phone:     user.phone,
        country:   user.country,
        role:      user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.country,
              COALESCE(r.role, 'user') AS role
       FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
