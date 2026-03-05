/**
 * middleware/auth.js
 * Verifies Bearer JWT and attaches req.user = { id, email, role }
 * requireRole(role) can be used to gate admin-only routes.
 */
'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

/**
 * requireAuth — verifies the JWT, attaches req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireRole(role) — middleware factory; use AFTER requireAuth.
 * e.g.  router.delete('/:id', requireAuth, requireRole('master_admin'), handler)
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
