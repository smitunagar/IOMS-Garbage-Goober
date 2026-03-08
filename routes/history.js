const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');
const { fmtDateTime } = require('../utils/rotation');

const router = express.Router();

/* ── GET /history ────────────────────────────────────────────────────────── */
router.get('/', requireAuth, requireOnboarded, (req, res) => {
  const user = res.locals.user;
  const filter = req.query.filter || 'all'; // all | disposal | alert

  /* ── Disposals ─────────────────────────────────────────────────────────── */
  const disposals = db().prepare(
    `SELECT de.*, u.name AS user_name
     FROM disposal_events de
     LEFT JOIN users u ON u.id = de.user_id
     WHERE de.floor_id = ?
     ORDER BY de.created_at DESC
     LIMIT 100`
  ).all(user.floor_id);

  /* ── Alerts ────────────────────────────────────────────────────────────── */
  const alerts = db().prepare(
    `SELECT ba.*, u.name AS user_name
     FROM bin_alerts ba
     LEFT JOIN users u ON u.id = ba.user_id
     WHERE ba.floor_id = ?
     ORDER BY ba.created_at DESC
     LIMIT 100`
  ).all(user.floor_id);

  /* ── Merge & sort ──────────────────────────────────────────────────────── */
  let entries = [];

  if (filter === 'all' || filter === 'disposal') {
    disposals.forEach(d => {
      let binTypes = [];
      try { binTypes = JSON.parse(d.bin_types); } catch (_) {}
      entries.push({
        type: 'disposal',
        date: d.created_at,
        userName: d.user_name,
        roomId: d.room_id,
        binTypes,
        note: d.note,
        photoPath: d.photo_path,
        qrVerified: d.qr_verified,
      });
    });
  }

  if (filter === 'all' || filter === 'alert') {
    alerts.forEach(a => {
      entries.push({
        type: 'alert',
        date: a.created_at,
        userName: a.user_name,
        binType: a.bin_type,
        note: a.note,
        isResolved: a.is_resolved,
      });
    });
  }

  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render('history/index', {
    layout: 'layout',
    pageTitle: res.locals.t('historyTitle'),
    entries,
    filter,
    BIN_TYPES,
    fmtDateTime,
  });
});

module.exports = router;
