const express = require('express');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');

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

/* ── POST /disposal/log ──────────────────────────────────────────────────── */
router.post('/log', requireAuth, requireOnboarded, upload.single('photo'), async (req, res) => {
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

  let photoPath = null;
  try {
    const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
    photoPath = result.secure_url;
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    req.session.flash = { error: t('errorGeneric', { error: 'Photo upload failed' }) };
    return res.redirect('/disposal/log');
  }

  await db().run(
    `INSERT INTO disposal_events (user_id, room_id, floor_id, bin_types, note, photo_path, qr_verified)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [user.id, user.room_id, user.floor_id, JSON.stringify(selectedBins), note || null, photoPath]
  );

  req.session.flash = { success: t('disposalLoggedSuccess') };
  res.redirect('/home');
});

module.exports = router;
