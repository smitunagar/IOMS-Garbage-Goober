const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { BIN_TYPES } = require('../utils/constants');
const {
  getDutyForWeek, upcomingDutyEntries, getWeekStart, getWeekEnd, getWeekStartStr,
  daysRemainingInWeek, weekRangeLabel, fmtDateTime,
} = require('../utils/rotation');

const router = express.Router();

router.get('/', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const t = res.locals.t;
  const floorId = user.floor_id;

  /* ── Duty info ──────────────────────────────────────────────────────────── */
  let dutyRoom = null;
  let isYourTurn = false;
  let upcoming = [];

  const anchor = await db().queryOne('SELECT id FROM duty_anchors WHERE floor_id = $1', [floorId]);
  if (anchor) {
    dutyRoom   = await getDutyForWeek(db(), floorId, getWeekStartStr());
    isYourTurn = dutyRoom === user.room_id;
    upcoming   = await upcomingDutyEntries(db(), floorId, 4);
  }

  /* ── This-week disposals ────────────────────────────────────────────────── */
  const weekStart = getWeekStart().toISOString();
  const weekEnd = getWeekEnd().toISOString();

  const disposals = await db().query(
    `SELECT * FROM disposal_events
     WHERE floor_id = $1 AND created_at >= $2 AND created_at <= $3
     ORDER BY created_at DESC`,
    [floorId, weekStart, weekEnd]
  );

  // Count per bin type
  const binCounts = {};
  Object.keys(BIN_TYPES).forEach(k => { binCounts[k] = 0; });
  disposals.forEach(d => {
    try {
      const types = JSON.parse(d.bin_types);
      types.forEach(bt => { if (binCounts[bt] !== undefined) binCounts[bt]++; });
    } catch (_) {}
  });

  const lastDisposal = disposals.length > 0 ? disposals[0] : null;

  /* ── Open alerts ────────────────────────────────────────────────────────── */
  const openAlerts = await db().query(
    'SELECT * FROM bin_alerts WHERE floor_id = $1 AND is_resolved = 0 ORDER BY created_at DESC',
    [floorId]
  );

  /* ── Render ─────────────────────────────────────────────────────────────── */
  res.render('home/dashboard', {
    layout: 'layout',
    pageTitle: t('dashboardTitle'),
    dutyRoom,
    isYourTurn,
    upcoming,
    disposals,
    binCounts,
    lastDisposal,
    openAlerts,
    daysLeft: daysRemainingInWeek(),
    weekLabel: weekRangeLabel(),
    BIN_TYPES,
    fmtDateTime,
  });
});

module.exports = router;
