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
  const weekStart = getWeekStart().toISOString();
  const weekEnd   = getWeekEnd().toISOString();
  const weekStr   = getWeekStartStr();

  /* ── Run independent queries in parallel ────────────────────────────────── */
  const [anchor, disposals, openAlerts] = await Promise.all([
    db().queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]),
    db().query(
      `SELECT id, floor_id, room_id, bin_types, note, created_at
       FROM disposal_events
       WHERE floor_id = $1 AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at DESC`,
      [floorId, weekStart, weekEnd]
    ),
    db().query(
      'SELECT id, bin_type, note, created_at FROM bin_alerts WHERE floor_id = $1 AND is_resolved = 0 ORDER BY created_at DESC',
      [floorId]
    ),
  ]);

  /* ── Duty info (needs anchor result, so starts after parallel batch) ────── */
  let dutyRoom = null;
  let isYourTurn = false;
  let upcoming = [];

  if (anchor) {
    [dutyRoom, upcoming] = await Promise.all([
      getDutyForWeek(db(), floorId, weekStr),
      upcomingDutyEntries(db(), floorId, 4),
    ]);
    isYourTurn = dutyRoom === user.room_id;
  }

  /* ── Bin counts ─────────────────────────────────────────────────────────── */
  const binCounts = {};
  Object.keys(BIN_TYPES).forEach(k => { binCounts[k] = 0; });
  disposals.forEach(d => {
    try {
      const types = JSON.parse(d.bin_types);
      types.forEach(bt => { if (binCounts[bt] !== undefined) binCounts[bt]++; });
    } catch (_) {}
  });

  const lastDisposal = disposals.length > 0 ? disposals[0] : null;

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
