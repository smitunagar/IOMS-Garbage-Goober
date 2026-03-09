const express = require('express');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');
const { fmtDateTime } = require('../utils/rotation');

const router = express.Router();

// Configure Cloudinary (uses CLOUDINARY_URL env var or individual vars)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer: memory storage (file held in buffer, uploaded to Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// Upload buffer to Cloudinary and return secure URL
function uploadToCloudinary(buffer, mimetype) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'ioms-disposals', resource_type: 'image' },
      (error, result) => { if (error) reject(error); else resolve(result); }
    );
    stream.end(buffer);
  });
}

/* ── GET /disposal/log ───────────────────────────────────────────────────── */
router.get('/log', requireAuth, requireOnboarded, (req, res) => {
  res.render('disposal/log', {
    layout: 'layout',
    pageTitle: res.locals.t('logDisposalTitle'),
    BIN_TYPES,
  });
});

/* ── GET /disposal/feed ──────────────────────────────────────────────────── */
router.get('/feed', requireAuth, requireOnboarded, async (req, res) => {
  const PER_PAGE = 24;
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const offset   = (page - 1) * PER_PAGE;

  const rows = await db().query(
    `SELECT de.id, de.floor_id, de.room_id, de.bin_types, de.note,
            de.photo_path, de.created_at,
            u.name AS user_name
     FROM disposal_events de
     LEFT JOIN users u ON u.id = de.user_id
     ORDER BY de.created_at DESC
     LIMIT $1 OFFSET $2`,
    [PER_PAGE + 1, offset]
  );

  const hasMore = rows.length > PER_PAGE;
  const entries = rows.slice(0, PER_PAGE).map(e => {
    let binTypes = [];
    try { binTypes = JSON.parse(e.bin_types); } catch (_) {}
    let photoPaths = [];
    if (e.photo_path) {
      try {
        const p = JSON.parse(e.photo_path);
        photoPaths = Array.isArray(p) ? p : [e.photo_path];
      } catch (_) { photoPaths = [e.photo_path]; }
    }
    return {
      id:        e.id,
      userName:  e.user_name || '—',
      floorId:   e.floor_id,
      roomId:    e.room_id,
      binTypes,
      note:      e.note,
      photoPaths,
      date:      e.created_at,
    };
  });

  res.render('disposal/feed', {
    layout:    'layout',
    pageTitle: res.locals.lang === 'de' ? 'Entsorgungsprotokoll' : 'Disposal Feed',
    entries,
    page,
    hasMore,
    BIN_TYPES,
    fmtDateTime,
  });
});

/* ── POST /disposal/log ──────────────────────────────────────────────────── */
router.post('/log', requireAuth, requireOnboarded, upload.array('photos', 4), async (req, res) => {
  const user = res.locals.user;
  const lang = res.locals.lang || 'en';
  const t    = res.locals.t;
  const { bins, note } = req.body;

  // Validate bins
  const selectedBins = Array.isArray(bins) ? bins : (bins ? [bins] : []);
  if (selectedBins.length === 0) {
    req.session.flash = { error: t('selectAtLeastOneBin') };
    return res.redirect('/disposal/log');
  }

  // Require one photo per bin
  const files = req.files || [];
  if (files.length === 0) {
    req.session.flash = { error: lang === 'de' ? 'Bitte für jeden Behälter ein Foto hochladen.' : 'Please upload a photo for each bin.' };
    return res.redirect('/disposal/log');
  }
  if (files.length < selectedBins.length) {
    req.session.flash = { error: lang === 'de'
      ? `Bitte für alle ${selectedBins.length} Behälter ein Foto hinzufügen (${files.length} hochgeladen).`
      : `Please add a photo for all ${selectedBins.length} bins (${files.length} uploaded).` };
    return res.redirect('/disposal/log');
  }

  // Upload all photos to Cloudinary in parallel
  let photoPaths = [];
  try {
    const results = await Promise.all(
      files.map(f => uploadToCloudinary(f.buffer, f.mimetype))
    );
    photoPaths = results.map(r => r.secure_url);
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    req.session.flash = { error: lang === 'de' ? 'Foto-Upload fehlgeschlagen. Bitte erneut versuchen.' : 'Photo upload failed. Please try again.' };
    return res.redirect('/disposal/log');
  }

  await db().run(
    `INSERT INTO disposal_events (user_id, room_id, floor_id, bin_types, note, photo_path, qr_verified)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [user.id, user.room_id, user.floor_id, JSON.stringify(selectedBins), note || null, JSON.stringify(photoPaths)]
  );

  req.session.flash = { success: t('disposalLoggedSuccess') };
  res.redirect('/home');
});

module.exports = router;
