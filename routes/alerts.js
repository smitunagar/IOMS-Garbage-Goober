const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES, MAX_BIN_ALERTS_PER_DAY } = require('../utils/constants');

const router = express.Router();

/* ── GET /alerts/report ──────────────────────────────────────────────────── */
router.get('/report', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;

  // Count today's alerts
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = await db().queryOne(
    'SELECT COUNT(*)::int as cnt FROM bin_alerts WHERE user_id = $1 AND created_at >= $2',
    [user.id, todayStart.toISOString()]
  );
  const todayCount = row ? row.cnt : 0;

  const remaining = Math.max(0, MAX_BIN_ALERTS_PER_DAY - todayCount);

  res.render('alerts/report', {
    layout: 'layout',
    pageTitle: res.locals.t('reportBinFullTitle'),
    BIN_TYPES,
    remaining,
    maxPerDay: MAX_BIN_ALERTS_PER_DAY,
  });
});

/* ── POST /alerts/report ─────────────────────────────────────────────────── */
router.post('/report', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const t = res.locals.t;
  const { binType, note } = req.body;

  if (!binType || !BIN_TYPES[binType]) {
    req.session.flash = { error: t('selectOneBin') };
    return res.redirect('/alerts/report');
  }

  // Rate-limit check
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = await db().queryOne(
    'SELECT COUNT(*)::int as cnt FROM bin_alerts WHERE user_id = $1 AND created_at >= $2',
    [user.id, todayStart.toISOString()]
  );
  const todayCount = row ? row.cnt : 0;

  if (todayCount >= MAX_BIN_ALERTS_PER_DAY) {
    req.session.flash = { error: t('dailyLimitReached', { max: MAX_BIN_ALERTS_PER_DAY }) };
    return res.redirect('/alerts/report');
  }

  await db().run(
    'INSERT INTO bin_alerts (user_id, floor_id, bin_type, note) VALUES ($1, $2, $3, $4)',
    [user.id, user.floor_id, binType, note || null]
  );

  req.session.flash = { success: t('alertSentSuccess') };
  res.redirect('/home');
});

module.exports = router;
