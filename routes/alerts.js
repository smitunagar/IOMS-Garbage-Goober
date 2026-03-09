const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES, MAX_BIN_ALERTS_PER_DAY } = require('../utils/constants');
const { getDutyForWeek, getWeekStartStr } = require('../utils/rotation');
const { sendBinAlert } = require('../utils/whatsapp');

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

  // ── WhatsApp notification to duty person ─────────────────────────────────
  try {
    const weekStr = getWeekStartStr();
    const dutyRoomId = await getDutyForWeek(db(), user.floor_id, weekStr);

    if (dutyRoomId) {
      // Find the user who lives in the duty room on this floor
      const dutyUser = await db().queryOne(
        'SELECT name, phone, whatsapp_key FROM users WHERE floor_id = $1 AND room_id = $2 AND is_onboarded = 1 LIMIT 1',
        [user.floor_id, dutyRoomId]
      );

      if (dutyUser && dutyUser.phone && dutyUser.whatsapp_key) {
        const bin = BIN_TYPES[binType];
        // Fire-and-forget — don't block the response
        sendBinAlert({
          dutyName:     dutyUser.name,
          phone:        dutyUser.phone,
          apiKey:       dutyUser.whatsapp_key,
          binLabel:     bin.label_de,
          binEmoji:     bin.emoji,
          reporterName: user.name,
          floor:        user.floor_id,
          note:         note || null,
        }).catch(err => console.error('[WhatsApp] sendBinAlert failed:', err));
      }
    }
  } catch (err) {
    // Never block the response if WhatsApp logic fails
    console.error('[WhatsApp] Notification error:', err);
  }

  req.session.flash = { success: t('alertSentSuccess') };
  res.redirect('/home');
});

module.exports = router;
