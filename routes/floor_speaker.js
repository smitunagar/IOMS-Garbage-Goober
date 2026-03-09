'use strict';
const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess } = require('../middleware/auth');
const { TOTAL_FLOORS } = require('../utils/constants');
const {
  getDutyForWeek, adminOverrideDuty, invalidateFutureSchedule,
  getWeekStart, getWeekStartStr, weekRangeLabel, fmtDate,
} = require('../utils/rotation');

const router = express.Router();

/* ── GET /floor-speaker/rotation/:floorId ────────────────────────────────── */
router.get('/rotation/:floorId', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, async (req, res) => {
  const t = res.locals.t;
  const floorId = parseInt(req.params.floorId);
  if (floorId < 1 || floorId > TOTAL_FLOORS) return res.redirect('/home');

  const anchor = await db().queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]);
  const rooms  = await db().query(
    'SELECT * FROM rooms WHERE floor_id = $1 ORDER BY room_number', [floorId]
  );

  const activeRooms = rooms.filter(r => r.is_active).map(r => r.room_number);
  const currentWeekStart = getWeekStartStr();
  let dutyRoom   = null;
  let dutySource = null;

  if (anchor && activeRooms.length > 0) {
    dutyRoom = await getDutyForWeek(db(), floorId, currentWeekStart);
    const sched = await db().queryOne(
      'SELECT * FROM duty_schedule WHERE floor_id = $1 AND week_start = $2',
      [floorId, currentWeekStart]
    );
    if (sched) dutySource = sched.is_override ? 'override' : (sched.is_from_pending ? 'pending' : 'normal');
  }

  const holidays = await db().query(
    'SELECT * FROM room_holidays WHERE floor_id = $1 ORDER BY start_date DESC', [floorId]
  );
  const pendingQueue = await db().query(
    'SELECT * FROM pending_duty_queue WHERE floor_id = $1 AND is_processed = 0 ORDER BY queued_at ASC',
    [floorId]
  );

  res.render('floor_speaker/rotation', {
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

/* ── POST /floor-speaker/rotation/:floorId ── save anchor / override ─────── */
router.post('/rotation/:floorId', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, async (req, res) => {
  const t = res.locals.t;
  const floorId = parseInt(req.params.floorId);
  const { anchorDate, overrideRoom } = req.body;
  const user = res.locals.user;

  if (anchorDate) {
    const existing = await db().queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]);
    const rooms = await db().query(
      'SELECT room_number FROM rooms WHERE floor_id = $1 AND is_active = 1 ORDER BY room_number', [floorId]
    );
    const activeRooms = rooms.map(r => r.room_number);
    const anchorRoom  = activeRooms.length > 0 ? activeRooms[0] : floorId * 100 + 1;

    if (existing) {
      await db().run(
        `UPDATE duty_anchors SET anchor_start_monday = $1, anchor_room_id = $2,
         manual_override_room_id = NULL, updated_by = $3, updated_at = NOW()
         WHERE floor_id = $4`,
        [anchorDate, anchorRoom, user.name, floorId]
      );
    } else {
      await db().run(
        `INSERT INTO duty_anchors (floor_id, anchor_start_monday, anchor_room_id, updated_by)
         VALUES ($1, $2, $3, $4)`,
        [floorId, anchorDate, anchorRoom, user.name]
      );
    }
    await invalidateFutureSchedule(db(), floorId);
  }

  if (overrideRoom) {
    await adminOverrideDuty(db(), floorId, getWeekStartStr(), parseInt(overrideRoom));
  }

  req.session.flash = { success: t('changesSavedSuccess') };
  res.redirect(`/floor-speaker/rotation/${floorId}`);
});

/* ── POST /floor-speaker/rotation/:floorId/toggle-room ── JSON ───────────── */
router.post('/rotation/:floorId/toggle-room', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, express.json(), async (req, res) => {
  const floorId = parseInt(req.params.floorId);
  const { roomNumber } = req.body;

  const room = await db().queryOne(
    'SELECT * FROM rooms WHERE floor_id = $1 AND room_number = $2',
    [floorId, roomNumber]
  );
  if (!room) return res.json({ ok: false, error: 'Room not found' });

  await db().run(
    'UPDATE rooms SET is_active = $1 WHERE id = $2',
    [room.is_active ? 0 : 1, room.id]
  );
  await invalidateFutureSchedule(db(), floorId);

  res.json({ ok: true, isActive: !room.is_active });
});

/* ── POST /floor-speaker/rotation/:floorId/add-holiday ───────────────────── */
router.post('/rotation/:floorId/add-holiday', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, express.urlencoded({ extended: false }), async (req, res) => {
  const floorId = parseInt(req.params.floorId);
  const { roomNumber, startDate, endDate, note } = req.body;
  const user = res.locals.user;
  const t = res.locals.t;

  if (!roomNumber || !startDate || !endDate) {
    req.session.flash = { error: t('holidayFieldsRequired') };
    return res.redirect(`/floor-speaker/rotation/${floorId}`);
  }
  if (endDate < startDate) {
    req.session.flash = { error: t('holidayEndBeforeStart') };
    return res.redirect(`/floor-speaker/rotation/${floorId}`);
  }

  await db().run(
    'INSERT INTO room_holidays (room_number, floor_id, start_date, end_date, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [parseInt(roomNumber), floorId, startDate, endDate, note || null, user.name]
  );
  await invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayAddedSuccess') };
  res.redirect(`/floor-speaker/rotation/${floorId}`);
});

/* ── POST /floor-speaker/rotation/:floorId/remove-holiday ────────────────── */
router.post('/rotation/:floorId/remove-holiday', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, express.urlencoded({ extended: false }), async (req, res) => {
  const floorId   = parseInt(req.params.floorId);
  const holidayId = parseInt(req.body.holidayId);
  const t = res.locals.t;

  await db().run('DELETE FROM room_holidays WHERE id = $1 AND floor_id = $2', [holidayId, floorId]);
  await invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayRemovedSuccess') };
  res.redirect(`/floor-speaker/rotation/${floorId}`);
});

/* ── POST /floor-speaker/rotation/:floorId/clear-pending ─────────────────── */
router.post('/rotation/:floorId/clear-pending', requireAuth, requireOnboarded, requireFloorSpeaker, requireFloorAccess, express.urlencoded({ extended: false }), async (req, res) => {
  const floorId   = parseInt(req.params.floorId);
  const pendingId = parseInt(req.body.pendingId);
  const t = res.locals.t;

  await db().run(
    'DELETE FROM pending_duty_queue WHERE id = $1 AND floor_id = $2 AND is_processed = 0',
    [pendingId, floorId]
  );

  req.session.flash = { success: t('pendingRemovedSuccess') };
  res.redirect(`/floor-speaker/rotation/${floorId}`);
});

module.exports = router;
