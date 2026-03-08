const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded, requireAdmin } = require('../middleware/auth');
const { TOTAL_FLOORS, BIN_TYPES } = require('../utils/constants');
const {
  getDutyForWeek, adminOverrideDuty, invalidateFutureSchedule,
  getWeekStart, getWeekEnd, getWeekStartStr, weekRangeLabel, fmtDate,
} = require('../utils/rotation');

const router = express.Router();

/* ── GET /admin ── dashboard overview ────────────────────────────────────── */
router.get('/', requireAuth, requireOnboarded, requireAdmin, (req, res) => {
  const t = res.locals.t;
  const weekStart = getWeekStart().toISOString();
  const weekEnd = getWeekEnd().toISOString();

  const floors = [];
  for (let f = 1; f <= TOTAL_FLOORS; f++) {
    const anchor = db().prepare('SELECT * FROM duty_anchors WHERE floor_id = ?').get(f);
    const activeRooms = db().prepare(
      'SELECT room_number FROM rooms WHERE floor_id = ? AND is_active = 1 ORDER BY room_number'
    ).all(f).map(r => r.room_number);

    let dutyRoom = null;
    if (anchor && activeRooms.length > 0) {
      dutyRoom = getDutyForWeek(db(), f, getWeekStartStr());
    }

    const disposalCount = db().prepare(
      `SELECT COUNT(*) as cnt FROM disposal_events
       WHERE floor_id = ? AND created_at >= ? AND created_at <= ?`
    ).get(f, weekStart, weekEnd).cnt;

    const alertCount = db().prepare(
      `SELECT COUNT(*) as cnt FROM bin_alerts
       WHERE floor_id = ? AND is_resolved = 0`
    ).get(f).cnt;

    floors.push({ id: f, dutyRoom, disposalCount, alertCount, activeRooms });
  }

  res.render('admin/dashboard', {
    layout: 'layout',
    pageTitle: t('adminDashboardTitle'),
    floors,
    weekLabel: weekRangeLabel(),
  });
});

/* ── GET /admin/rotation/:floorId ────────────────────────────────────────── */
router.get('/rotation/:floorId', requireAuth, requireOnboarded, requireAdmin, (req, res) => {
  const t = res.locals.t;
  const floorId = parseInt(req.params.floorId);
  if (floorId < 1 || floorId > TOTAL_FLOORS) return res.redirect('/admin');

  const anchor = db().prepare('SELECT * FROM duty_anchors WHERE floor_id = ?').get(floorId);
  const rooms = db().prepare(
    'SELECT * FROM rooms WHERE floor_id = ? ORDER BY room_number'
  ).all(floorId);

  const activeRooms = rooms.filter(r => r.is_active).map(r => r.room_number);
  const currentWeekStart = getWeekStartStr();
  let dutyRoom = null;
  let dutySource = null;
  if (anchor && activeRooms.length > 0) {
    dutyRoom = getDutyForWeek(db(), floorId, currentWeekStart);
    const sched = db().prepare('SELECT * FROM duty_schedule WHERE floor_id = ? AND week_start = ?').get(floorId, currentWeekStart);
    if (sched) dutySource = sched.is_override ? 'override' : (sched.is_from_pending ? 'pending' : 'normal');
  }

  const holidays = db().prepare(
    'SELECT * FROM room_holidays WHERE floor_id = ? ORDER BY start_date DESC'
  ).all(floorId);

  const pendingQueue = db().prepare(
    'SELECT * FROM pending_duty_queue WHERE floor_id = ? AND is_processed = 0 ORDER BY queued_at ASC'
  ).all(floorId);

  res.render('admin/rotation', {
    layout: 'layout',
    pageTitle: t('rotationScreenTitle', { floor: floorId }),
    floorId,
    anchor,
    rooms,
    dutyRoom,
    dutySource,
    activeRooms,
    holidays,
    pendingQueue,
    currentWeekStart,
    fmtDate,
  });
});

/* ── POST /admin/rotation/:floorId ── save anchor / override ─────────────── */
router.post('/rotation/:floorId', requireAuth, requireOnboarded, requireAdmin, (req, res) => {
  const t = res.locals.t;
  const floorId = parseInt(req.params.floorId);
  const { anchorDate, overrideRoom } = req.body;
  const user = res.locals.user;

  if (anchorDate) {
    const existing = db().prepare('SELECT * FROM duty_anchors WHERE floor_id = ?').get(floorId);
    const activeRooms = db().prepare(
      'SELECT room_number FROM rooms WHERE floor_id = ? AND is_active = 1 ORDER BY room_number'
    ).all(floorId).map(r => r.room_number);
    const anchorRoom = activeRooms.length > 0 ? activeRooms[0] : floorId * 100 + 1;

    if (existing) {
      db().prepare(
        `UPDATE duty_anchors SET anchor_start_monday = ?, anchor_room_id = ?,
         manual_override_room_id = NULL, updated_by = ?, updated_at = datetime('now')
         WHERE floor_id = ?`
      ).run(anchorDate, anchorRoom, user.name, floorId);
    } else {
      db().prepare(
        `INSERT INTO duty_anchors (floor_id, anchor_start_monday, anchor_room_id, updated_by)
         VALUES (?, ?, ?, ?)`
      ).run(floorId, anchorDate, anchorRoom, user.name);
    }
    // Anchor changed: invalidate future computed schedule so it is recomputed
    invalidateFutureSchedule(db(), floorId);
  }

  if (overrideRoom) {
    // Admin override for the current week only
    adminOverrideDuty(db(), floorId, getWeekStartStr(), parseInt(overrideRoom));
  }

  req.session.flash = { success: t('changesSavedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/toggle-room ── JSON endpoint ──────────── */
router.post('/rotation/:floorId/toggle-room', requireAuth, requireOnboarded, requireAdmin, express.json(), (req, res) => {
  const floorId = parseInt(req.params.floorId);
  const { roomNumber } = req.body;

  const room = db().prepare(
    'SELECT * FROM rooms WHERE floor_id = ? AND room_number = ?'
  ).get(floorId, roomNumber);

  if (!room) return res.json({ ok: false, error: 'Room not found' });

  db().prepare(
    'UPDATE rooms SET is_active = ? WHERE id = ?'
  ).run(room.is_active ? 0 : 1, room.id);

  // Room availability changed: recompute future weeks
  invalidateFutureSchedule(db(), floorId);

  res.json({ ok: true, isActive: !room.is_active });
});

/* ── POST /admin/rotation/:floorId/add-holiday ────────────────────────────── */
router.post('/rotation/:floorId/add-holiday', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), (req, res) => {
  const floorId = parseInt(req.params.floorId);
  const { roomNumber, startDate, endDate, note } = req.body;
  const user = res.locals.user;
  const t = res.locals.t;

  if (!roomNumber || !startDate || !endDate) {
    req.session.flash = { error: t('holidayFieldsRequired') };
    return res.redirect(`/admin/rotation/${floorId}`);
  }
  if (endDate < startDate) {
    req.session.flash = { error: t('holidayEndBeforeStart') };
    return res.redirect(`/admin/rotation/${floorId}`);
  }

  db().prepare(
    'INSERT INTO room_holidays (room_number, floor_id, start_date, end_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(parseInt(roomNumber), floorId, startDate, endDate, note || null, user.name);

  // Invalidate future schedule so holiday is reflected in upcoming weeks
  invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayAddedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/remove-holiday ─────────────────────────── */
router.post('/rotation/:floorId/remove-holiday', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), (req, res) => {
  const floorId   = parseInt(req.params.floorId);
  const holidayId = parseInt(req.body.holidayId);
  const t = res.locals.t;

  db().prepare('DELETE FROM room_holidays WHERE id = ? AND floor_id = ?').run(holidayId, floorId);
  invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayRemovedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/clear-pending ──────────────────────────── */
router.post('/rotation/:floorId/clear-pending', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), (req, res) => {
  const floorId    = parseInt(req.params.floorId);
  const pendingId  = parseInt(req.body.pendingId);
  const t = res.locals.t;

  db().prepare('DELETE FROM pending_duty_queue WHERE id = ? AND floor_id = ? AND is_processed = 0')
    .run(pendingId, floorId);

  req.session.flash = { success: t('pendingRemovedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── GET /admin/compliance ───────────────────────────────────────────────── */
router.get('/compliance', requireAuth, requireOnboarded, requireAdmin, (req, res) => {
  const t = res.locals.t;
  const filterFloor = req.query.floor ? parseInt(req.query.floor) : null;

  // Build last 8 weeks of compliance data
  const weeks = [];
  for (let w = 0; w < 8; w++) {
    const weekStart = new Date(getWeekStart());
    weekStart.setDate(weekStart.getDate() - w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekLabel = `KW ${getISOWeek(weekStart)}`;

    for (let f = 1; f <= TOTAL_FLOORS; f++) {
      if (filterFloor && f !== filterFloor) continue;

      const disposalCount = db().prepare(
        `SELECT COUNT(*) as cnt FROM disposal_events
         WHERE floor_id = ? AND created_at >= ? AND created_at <= ?`
      ).get(f, weekStart.toISOString(), weekEnd.toISOString()).cnt;

      const alertCount = db().prepare(
        `SELECT COUNT(*) as cnt FROM bin_alerts
         WHERE floor_id = ? AND created_at >= ? AND created_at <= ?`
      ).get(f, weekStart.toISOString(), weekEnd.toISOString()).cnt;

      weeks.push({
        weekLabel,
        floorId: f,
        disposalCount,
        alertCount,
        weekStart: fmtDate(weekStart),
        weekEnd: fmtDate(weekEnd),
      });
    }
  }

  res.render('admin/compliance', {
    layout: 'layout',
    pageTitle: t('complianceReportTitle'),
    weeks,
    filterFloor,
    totalFloors: TOTAL_FLOORS,
  });
});

/* ── Helper: ISO week number ─────────────────────────────────────────────── */
function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

module.exports = router;
