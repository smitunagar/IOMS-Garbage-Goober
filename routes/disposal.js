'use strict';
const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');
const { fmtDateTime } = require('../utils/rotation');

const router = express.Router();

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

/* ── POST /disposal/log (JSON body, photos as base64 data URIs) ──────────── */
router.post('/log', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const lang = res.locals.lang || 'en';
  const t    = res.locals.t;
  const { bins, note, photos } = req.body;

  // Validate bins
  const selectedBins = Array.isArray(bins) ? bins : (bins ? [bins] : []);
  if (selectedBins.length === 0) {
    return res.json({ ok: false, error: lang === 'de' ? 'Bitte mindestens einen Behälter auswählen.' : 'Please select at least one bin.' });
  }

  // Validate photos
  const photoList = Array.isArray(photos) ? photos.filter(Boolean) : (photos ? [photos] : []);
  if (photoList.length === 0) {
    return res.json({ ok: false, error: lang === 'de' ? 'Bitte für jeden Behälter ein Foto hochladen.' : 'Please upload a photo for each bin.' });
  }
  if (photoList.length < selectedBins.length) {
    return res.json({ ok: false, error: lang === 'de'
      ? `Bitte für alle ${selectedBins.length} Behälter ein Foto hinzufügen.`
      : `Please add a photo for all ${selectedBins.length} bins.` });
  }

  await db().run(
    `INSERT INTO disposal_events (user_id, room_id, floor_id, bin_types, note, photo_path, qr_verified)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [user.id, user.room_id, user.floor_id, JSON.stringify(selectedBins), note || null, JSON.stringify(photoList)]
  );

  return res.json({ ok: true });
});

module.exports = router;
