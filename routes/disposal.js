const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');

const router = express.Router();

// Multer config for photo uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `disposal-${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

/* ── GET /disposal/log ───────────────────────────────────────────────────── */
router.get('/log', requireAuth, requireOnboarded, (req, res) => {
  res.render('disposal/log', {
    layout: 'layout',
    pageTitle: res.locals.t('logDisposalTitle'),
    BIN_TYPES,
  });
});

/* ── POST /disposal/log ──────────────────────────────────────────────────── */
router.post('/log', requireAuth, requireOnboarded, upload.single('photo'), (req, res) => {
  const user = res.locals.user;
  const t = res.locals.t;
  const { bins, note } = req.body;

  // Validate bins
  const selectedBins = Array.isArray(bins) ? bins : (bins ? [bins] : []);
  if (selectedBins.length === 0) {
    req.session.flash = { error: t('selectAtLeastOneBin') };
    return res.redirect('/disposal/log');
  }

  // Require photo
  if (!req.file) {
    const lang = res.locals.lang || 'en';
    req.session.flash = { error: lang === 'de' ? 'Bitte ein Foto als Nachweis hochladen.' : 'Please upload a photo as proof.' };
    return res.redirect('/disposal/log');
  }

  const photoPath = `/uploads/${req.file.filename}`;

  db().prepare(
    `INSERT INTO disposal_events (user_id, room_id, floor_id, bin_types, note, photo_path, qr_verified)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(
    user.id,
    user.room_id,
    user.floor_id,
    JSON.stringify(selectedBins),
    note || null,
    photoPath,
  );

  req.session.flash = { success: t('disposalLoggedSuccess') };
  res.redirect('/home');
});

module.exports = router;
