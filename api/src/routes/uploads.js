/**
 * routes/uploads.js
 *
 * POST   /api/uploads/glb   — upload a GLB file, returns { url }
 * DELETE /api/uploads/glb   — delete a file by path, body: { url }
 *
 * Files are stored at process.env.UPLOAD_DIR/<userId>/<filename>
 * and served from process.env.UPLOAD_PUBLIC_URL/<userId>/<filename>
 */
'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR        = process.env.UPLOAD_DIR        || path.join(__dirname, '../../uploads');
const UPLOAD_PUBLIC_URL = process.env.UPLOAD_PUBLIC_URL || 'https://realestatear.dev.sbgroup.tech/uploads';

// Multer — store to disk under UPLOAD_DIR/<userId>/
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dest = path.join(UPLOAD_DIR, req.user.id);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.glb';
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`File type ${ext} not allowed`));
  },
});

// ── POST /api/uploads/glb ────────────────────────────────────────
router.post('/glb', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const relativePath = path.join(req.user.id, req.file.filename).replace(/\\/g, '/');
  const publicUrl    = `${UPLOAD_PUBLIC_URL}/${relativePath}`;
  res.json({ url: publicUrl, path: relativePath });
});

// ── DELETE /api/uploads/glb ──────────────────────────────────────
// Body: { url: "https://.../.../uuid.glb" }  OR  { path: "userId/uuid.glb" }
router.delete('/glb', requireAuth, (req, res) => {
  const { url, path: relPath } = req.body;

  let rel = relPath;
  if (!rel && url) {
    // Strip base URL to get relative path
    rel = url.replace(UPLOAD_PUBLIC_URL, '').replace(/^\//, '');
  }

  if (!rel) return res.status(400).json({ error: 'url or path required' });

  // Security: ensure the path starts with req.user.id (users can only delete their own files)
  // Admins may need to delete other users' files — skip ownership check for master_admin
  if (!rel.startsWith(req.user.id) && req.user.role !== 'master_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const absPath = path.join(UPLOAD_DIR, rel);
  fs.unlink(absPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Could not delete file' });
    }
    res.json({ ok: true });
  });
});

module.exports = router;
