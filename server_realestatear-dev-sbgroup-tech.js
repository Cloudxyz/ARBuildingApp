require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3002);
const HOST = '127.0.0.1';

if (!process.env.JWT_SECRET) throw new Error('Missing JWT_SECRET in .env');

let pool;

/** ---------------- DB ---------------- */
async function initDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await pool.query('SELECT 1');
  console.log('✅ MySQL connected');
}

/** ---------------- Helpers ---------------- */
function signToken({ id, email, role }) {
  return jwt.sign({ sub: id, email, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { userId: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    if (req.auth.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

async function getUserWithRoleByEmail(email) {
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.password_hash, COALESCE(r.role,'user') AS role
     FROM users u
     LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE u.email = ?
     LIMIT 1`,
    [email]
  );
  return rows?.[0] || null;
}

async function getUserWithRoleById(id) {
  const [rows] = await pool.query(
    `SELECT u.id,u.email,u.full_name,u.phone,u.country,COALESCE(r.role,'user') AS role
     FROM users u
     LEFT JOIN user_roles r ON r.user_id=u.id
     WHERE u.id=? LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

/** ---------------- Health ---------------- */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** =========================================================
 * AUTH
 * =======================================================*/
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, phone, country } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone, country)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [email, password_hash, full_name || null, phone || null, country || null]
    );

    const [urows] = await pool.query(`SELECT id, email FROM users WHERE email=? LIMIT 1`, [email]);
    const user = urows?.[0];

    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES (?, 'user')
       ON DUPLICATE KEY UPDATE role=role`,
      [user.id]
    );

    const token = signToken({ id: user.id, email: user.email, role: 'user' });
    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, full_name: full_name || null, role: 'user' },
    });
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await getUserWithRoleByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    return res.json({
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name || null, role: user.role },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const me = await getUserWithRoleById(req.auth.userId);
  if (!me) return res.status(404).json({ error: 'User not found' });
  res.json({ user: me });
});

/** =========================================================
 * DEVELOPMENTS
 * =======================================================*/
app.get('/api/developments', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM developments ORDER BY created_at DESC`);
    res.json({ developments: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/developments/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM developments WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows?.[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ development: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/developments', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { name, type, description, address, city, state, country } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    await pool.query(
      `INSERT INTO developments (id, name, type, description, address, city, state, country, user_id)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, type || 'fraccionamiento', description || null, address || null,
       city || null, state || null, country || null, req.auth.userId]
    );

    const [rows] = await pool.query(
      `SELECT * FROM developments WHERE name=? AND user_id=? ORDER BY created_at DESC LIMIT 1`,
      [name, req.auth.userId]
    );
    res.status(201).json({ development: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.put('/api/developments/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { name, type, description, address, city, state, country } = req.body || {};
    await pool.query(
      `UPDATE developments
       SET name=COALESCE(?,name), type=COALESCE(?,type), description=COALESCE(?,description),
           address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state),
           country=COALESCE(?,country)
       WHERE id=?`,
      [name??null, type??null, description??null, address??null,
       city??null, state??null, country??null, req.params.id]
    );
    const [rows] = await pool.query(`SELECT * FROM developments WHERE id=? LIMIT 1`, [req.params.id]);
    res.json({ development: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.delete('/api/developments/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM developments WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

/** =========================================================
 * UNITS
 * =======================================================*/
app.get('/api/units', authRequired, async (req, res) => {
  try {
    const { development_id } = req.query || {};
    const params = [];
    let where = '';
    if (development_id) { where = 'WHERE development_id=?'; params.push(String(development_id)); }
    const [rows] = await pool.query(
      `SELECT * FROM units ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({ units: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/units/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM units WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows?.[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ unit: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/units', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const {
      development_id, name, description, address, city, state, country,
      unit_type, glb_url, area_sqm, latitude, longitude, price, status,
      thumbnail_url, floors,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    await pool.query(
      `INSERT INTO units
         (id, development_id, name, description, area_sqm, address, city, state, country,
          unit_type, glb_url, latitude, longitude, price, status, thumbnail_url, floors, user_id)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        development_id || null, name, description || null,
        area_sqm ?? null, address || null, city || null, state || null, country || null,
        unit_type || 'land', glb_url || null,
        latitude ?? null, longitude ?? null,
        price ?? null, status || 'available', thumbnail_url || null,
        floors ? JSON.stringify(floors) : null,
        req.auth.userId,
      ]
    );

    const [rows] = await pool.query(
      `SELECT * FROM units WHERE name=? AND user_id=? ORDER BY created_at DESC LIMIT 1`,
      [name, req.auth.userId]
    );
    res.status(201).json({ unit: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.put('/api/units/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const {
      development_id, name, description, address, city, state, country,
      unit_type, glb_url, area_sqm, latitude, longitude, price, status,
      thumbnail_url, floors,
    } = req.body || {};

    await pool.query(
      `UPDATE units
       SET development_id=COALESCE(?,development_id),
           name=COALESCE(?,name),
           description=COALESCE(?,description),
           area_sqm=COALESCE(?,area_sqm),
           address=COALESCE(?,address),
           city=COALESCE(?,city),
           state=COALESCE(?,state),
           country=COALESCE(?,country),
           unit_type=COALESCE(?,unit_type),
           glb_url=COALESCE(?,glb_url),
           latitude=COALESCE(?,latitude),
           longitude=COALESCE(?,longitude),
           price=COALESCE(?,price),
           status=COALESCE(?,status),
           thumbnail_url=COALESCE(?,thumbnail_url),
           floors=COALESCE(?,floors)
       WHERE id=?`,
      [
        development_id ?? null, name ?? null, description ?? null,
        area_sqm ?? null, address ?? null, city ?? null, state ?? null, country ?? null,
        unit_type ?? null, glb_url ?? null,
        latitude ?? null, longitude ?? null,
        price ?? null, status ?? null, thumbnail_url ?? null,
        floors ? JSON.stringify(floors) : null,
        req.params.id,
      ]
    );

    const [rows] = await pool.query(`SELECT * FROM units WHERE id=? LIMIT 1`, [req.params.id]);
    res.json({ unit: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.delete('/api/units/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM units WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});


/** ── Unit GLB Models (unit_glb_models) ───────────────────*/
app.get('/api/units/:id/glb-models', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM unit_glb_models WHERE unit_id=? ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ glb_models: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/units/:id/glb-models', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { glb_url, storage_path, label, unit_type, external_glb_url } = req.body || {};
    const resolvedType = unit_type || 'land';

    // Nothing to save — return success without creating a record
    if (!glb_url && !external_glb_url) {
      return res.json({ glb_model: null });
    }

    // Upsert: one row per (unit_id, unit_type)
    const [existing] = await pool.query(
      `SELECT * FROM unit_glb_models WHERE unit_id=? AND unit_type=? LIMIT 1`,
      [req.params.id, resolvedType]
    );

    if (existing.length) {
      const row = existing[0];
      const mergedGlbUrl      = 'glb_url'          in (req.body || {}) ? (glb_url          ?? null) : row.glb_url;
      const mergedStoragePath = 'storage_path'     in (req.body || {}) ? (storage_path     ?? null) : row.storage_path;
      const mergedExtUrl      = 'external_glb_url' in (req.body || {}) ? (external_glb_url ?? null) : row.external_glb_url;
      await pool.query(
        `UPDATE unit_glb_models SET glb_url=?, storage_path=?, external_glb_url=? WHERE id=?`,
        [mergedGlbUrl, mergedStoragePath, mergedExtUrl, row.id]
      );
      const [rows] = await pool.query(`SELECT * FROM unit_glb_models WHERE id=? LIMIT 1`, [row.id]);
      return res.json({ glb_model: rows[0] });
    }

    await pool.query(
      `INSERT INTO unit_glb_models
       (id, unit_id, glb_url, storage_path, label, unit_type, external_glb_url, user_id)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, glb_url || null, storage_path || null, label || null, resolvedType, external_glb_url || null, req.auth.userId]
    );

    const [rows] = await pool.query(
      `SELECT * FROM unit_glb_models WHERE unit_id=? AND unit_type=? ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, resolvedType]
    );
    res.status(201).json({ glb_model: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.put('/api/unit-glb-models/:modelId', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { glb_url, label, unit_type, external_glb_url } = req.body || {};
    await pool.query(
      `UPDATE unit_glb_models
        SET glb_url=COALESCE(?,glb_url),
            label=COALESCE(?,label),
            unit_type=COALESCE(?,unit_type),
            external_glb_url=COALESCE(?,external_glb_url)
        WHERE id=?`,
      [glb_url ?? null, label ?? null, unit_type ?? null, external_glb_url ?? null, req.params.modelId]
    );
    const [rows] = await pool.query(
      `SELECT * FROM unit_glb_models WHERE id=? LIMIT 1`,
      [req.params.modelId]
    );
    res.json({ glb_model: rows[0] || null });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.delete('/api/unit-glb-models/:modelId', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM unit_glb_models WHERE id=?`, [req.params.modelId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

/** ── Unit Type Models (unit_type_models) ─────────────────*/
app.get('/api/unit-type-models', authRequired, async (req, res) => {
  try {
    const { unit_type } = req.query || {};
    const params = [];
    let where = '';
    if (unit_type) { where = 'WHERE unit_type=?'; params.push(String(unit_type)); }
    const [rows] = await pool.query(
      `SELECT * FROM unit_type_models ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({ unit_type_models: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/unit-type-models', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { unit_type, name, glb_url, manual_url, model_glb_url, external_model_glb_url } = req.body || {};
    if (!unit_type) return res.status(400).json({ error: 'unit_type required' });

    const finalGlbUrl   = model_glb_url   || glb_url        || null;
    const finalManualUrl = external_model_glb_url || manual_url || null;

    const [existing] = await pool.query(
      `SELECT id FROM unit_type_models WHERE unit_type=? LIMIT 1`,
      [unit_type]
    );

    if (existing.length) {
      await pool.query(
        `UPDATE unit_type_models
         SET glb_url=COALESCE(?,glb_url), manual_url=COALESCE(?,manual_url)
         WHERE unit_type=?`,
        [finalGlbUrl, finalManualUrl, unit_type]
      );
    } else {
      await pool.query(
        `INSERT INTO unit_type_models (id, unit_type, name, glb_url, manual_url, created_by)
         VALUES (UUID(), ?, ?, ?, ?, ?)`,
        [unit_type, name || null, finalGlbUrl, finalManualUrl, req.auth.userId]
      );
    }

    const [rows] = await pool.query(
      `SELECT * FROM unit_type_models WHERE unit_type=? LIMIT 1`,
      [unit_type]
    );
    res.status(201).json({ unit_type_model: rows[0] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.put('/api/unit-type-models/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { unit_type, name, glb_url, manual_url, model_glb_url, external_model_glb_url } = req.body || {};
    const finalGlbUrl    = model_glb_url   || glb_url   || null;
    const finalManualUrl = external_model_glb_url || manual_url || null;

    await pool.query(
      `UPDATE unit_type_models
       SET unit_type=COALESCE(?,unit_type), name=COALESCE(?,name),
           glb_url=COALESCE(?,glb_url), manual_url=COALESCE(?,manual_url)
       WHERE id=?`,
      [unit_type ?? null, name ?? null, finalGlbUrl, finalManualUrl, req.params.id]
    );
    const [rows] = await pool.query(
      `SELECT * FROM unit_type_models WHERE id=? LIMIT 1`,
      [req.params.id]
    );
    res.json({ unit_type_model: rows[0] || null });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.delete('/api/unit-type-models/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM unit_type_models WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

/** =========================================================
 * UPLOADS (stub — implement cloud/disk storage when ready)
 * =======================================================*/
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/uploads/glb', authRequired, upload.single('file'), async (req, res) => {
  return res.status(501).json({ error: 'Upload not implemented yet' });
});

app.delete('/api/uploads/glb', authRequired, async (req, res) => {
  return res.status(501).json({ error: 'Delete upload not implemented yet' });
});

/** =========================================================
 * ADMIN
 * =======================================================*/
app.get('/api/admin/users', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.country, u.created_at,
              COALESCE(r.role,'user') AS role
       FROM users u
       LEFT JOIN user_roles r ON r.user_id=u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/admin/users', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { email, password, full_name, phone, country, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone, country)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [email, password_hash, full_name || null, phone || null, country || null]
    );

    const [urows] = await pool.query(`SELECT id, email FROM users WHERE email=? LIMIT 1`, [email]);
    const user = urows?.[0];
    const finalRole = role === 'master_admin' ? 'master_admin' : 'user';

    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE role=VALUES(role)`,
      [user.id, finalRole]
    );

    res.status(201).json({ ok: true, user: { id: user.id, email: user.email, role: finalRole } });
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.put('/api/admin/users/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { email, full_name, phone, country, role, password } = req.body || {};

    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE users SET
           email=COALESCE(?,email), full_name=COALESCE(?,full_name),
           phone=COALESCE(?,phone), country=COALESCE(?,country),
           password_hash=?
         WHERE id=?`,
        [email ?? null, full_name ?? null, phone ?? null, country ?? null, password_hash, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE users SET
           email=COALESCE(?,email), full_name=COALESCE(?,full_name),
           phone=COALESCE(?,phone), country=COALESCE(?,country)
         WHERE id=?`,
        [email ?? null, full_name ?? null, phone ?? null, country ?? null, req.params.id]
      );
    }

    if (role) {
      const finalRole = role === 'master_admin' ? 'master_admin' : 'user';
      await pool.query(
        `INSERT INTO user_roles (user_id, role) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE role=VALUES(role)`,
        [req.params.id, finalRole]
      );
    }

    const updated = await getUserWithRoleById(req.params.id);
    res.json({ ok: true, user: updated });
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/admin/users/:id', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.put('/api/admin/users/:id/role', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!role || !['user', 'master_admin'].includes(role))
      return res.status(400).json({ error: 'invalid role' });

    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE role=VALUES(role)`,
      [req.params.id, role]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/admin/developments', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, u.email AS created_by_email
       FROM developments d
       LEFT JOIN users u ON u.id=d.user_id
       ORDER BY d.created_at DESC`
    );
    res.json({ developments: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/admin/units', authRequired, requireRole('master_admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.*, d.name AS development_name, usr.email AS created_by_email
       FROM units u
       LEFT JOIN developments d ON d.id=u.development_id
       LEFT JOIN users usr ON usr.id=u.user_id
       ORDER BY u.created_at DESC`
    );
    res.json({ units: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

/** ── 404 ──────────────────────────────────────────────────*/
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

/** ── Global error handler ─────────────────────────────────*/
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

/** ---------------- Start ---------------- */
initDb()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`✅ API listening on http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ DB init failed:', err);
    process.exit(1);
  });