const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded, requireAdmin, invalidateUserCache } = require('../middleware/auth');
const { TOTAL_FLOORS, roomsForFloor } = require('../utils/constants');
const {
  getDutyForWeek, adminOverrideDuty, invalidateFutureSchedule,
  getWeekStart, getWeekEnd, getWeekStartStr, weekRangeLabel, fmtDate,
} = require('../utils/rotation');

const router = express.Router();

/* ── GET /admin ── dashboard overview ────────────────────────────────────── */
router.get('/', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;
  const weekStart = getWeekStart().toISOString();
  const weekEnd   = getWeekEnd().toISOString();

  const floors = [];
  for (let f = 1; f <= TOTAL_FLOORS; f++) {
    const [anchor, activeRoomsRows, disposalRow, alertRow] = await Promise.all([
      db().queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [f]),
      db().query('SELECT room_number FROM rooms WHERE floor_id = $1 AND is_active = 1 ORDER BY room_number', [f]),
      db().queryOne(
        `SELECT COUNT(*)::int AS cnt FROM disposal_events WHERE floor_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [f, weekStart, weekEnd]
      ),
      db().queryOne(
        `SELECT COUNT(*)::int AS cnt FROM bin_alerts WHERE floor_id = $1 AND is_resolved = 0`,
        [f]
      ),
    ]);

    const activeRooms = activeRoomsRows.map(r => r.room_number);
    let dutyRoom = null;
    if (anchor && activeRooms.length > 0) {
      dutyRoom = await getDutyForWeek(db(), f, getWeekStartStr());
    }

    floors.push({
      id: f,
      dutyRoom,
      disposalCount: disposalRow ? disposalRow.cnt : 0,
      alertCount:    alertRow    ? alertRow.cnt    : 0,
      activeRooms,
    });
  }

  const userStats = await db().queryOne(`
    SELECT
      COUNT(*)::int                                                        AS total,
      COUNT(*) FILTER (WHERE is_admin = 0 AND role != 'floor_speaker')::int AS students,
      COUNT(*) FILTER (WHERE role = 'floor_speaker')::int                  AS floor_speakers,
      COUNT(*) FILTER (WHERE is_suspended = 1 AND is_admin = 0)::int       AS suspended
    FROM users
  `);

  res.render('admin/dashboard', {
    layout: 'layout',
    pageTitle: t('adminDashboardTitle'),
    floors,
    weekLabel: weekRangeLabel(),
    userStats,
  });
});

/* ── GET /admin/rotation/:floorId ────────────────────────────────────────── */
router.get('/rotation/:floorId', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;
  const floorId = parseInt(req.params.floorId);
  if (floorId < 1 || floorId > TOTAL_FLOORS) return res.redirect('/admin');

  const anchor = await db().queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]);
  const rooms = await db().query(
    'SELECT * FROM rooms WHERE floor_id = $1 ORDER BY room_number', [floorId]
  );

  const activeRooms = rooms.filter(r => r.is_active).map(r => r.room_number);
  const currentWeekStart = getWeekStartStr();
  let dutyRoom = null;
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
router.post('/rotation/:floorId', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
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
    const anchorRoom = activeRooms.length > 0 ? activeRooms[0] : floorId * 100 + 1;

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
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/toggle-room ── JSON endpoint ──────────── */
router.post('/rotation/:floorId/toggle-room', requireAuth, requireOnboarded, requireAdmin, express.json(), async (req, res) => {
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

/* ── POST /admin/rotation/:floorId/add-holiday ────────────────────────────── */
router.post('/rotation/:floorId/add-holiday', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
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

  await db().run(
    'INSERT INTO room_holidays (room_number, floor_id, start_date, end_date, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [parseInt(roomNumber), floorId, startDate, endDate, note || null, user.name]
  );
  await invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayAddedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/remove-holiday ─────────────────────────── */
router.post('/rotation/:floorId/remove-holiday', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const floorId   = parseInt(req.params.floorId);
  const holidayId = parseInt(req.body.holidayId);
  const t = res.locals.t;

  await db().run('DELETE FROM room_holidays WHERE id = $1 AND floor_id = $2', [holidayId, floorId]);
  await invalidateFutureSchedule(db(), floorId);

  req.session.flash = { success: t('holidayRemovedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── POST /admin/rotation/:floorId/clear-pending ──────────────────────────── */
router.post('/rotation/:floorId/clear-pending', requireAuth, requireOnboarded, requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const floorId    = parseInt(req.params.floorId);
  const pendingId  = parseInt(req.body.pendingId);
  const t = res.locals.t;

  await db().run(
    'DELETE FROM pending_duty_queue WHERE id = $1 AND floor_id = $2 AND is_processed = 0',
    [pendingId, floorId]
  );

  req.session.flash = { success: t('pendingRemovedSuccess') };
  res.redirect(`/admin/rotation/${floorId}`);
});

/* ── GET /admin/compliance ───────────────────────────────────────────────── */
router.get('/compliance', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
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

      const dRow = await db().queryOne(
        `SELECT COUNT(*)::int as cnt FROM disposal_events
         WHERE floor_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [f, weekStart.toISOString(), weekEnd.toISOString()]
      );
      const aRow = await db().queryOne(
        `SELECT COUNT(*)::int as cnt FROM bin_alerts
         WHERE floor_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [f, weekStart.toISOString(), weekEnd.toISOString()]
      );

      weeks.push({
        weekLabel,
        floorId: f,
        disposalCount: dRow ? dRow.cnt : 0,
        alertCount: aRow ? aRow.cnt : 0,
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

/* ── GET /admin/users ─────────────────────────────────────────────────────── */
router.get('/users', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;

  const users = await db().query(`
    SELECT u.*,
      (SELECT COUNT(*)::int FROM disposal_events WHERE user_id = u.id) AS disposal_count,
      (SELECT COUNT(*)::int FROM bin_alerts       WHERE user_id = u.id) AS alert_count
    FROM users u
    ORDER BY u.created_at DESC
  `);

  const stats = {
    total:          users.length,
    students:       users.filter(u => !u.is_admin && u.role !== 'floor_speaker').length,
    floor_speakers: users.filter(u => u.role === 'floor_speaker').length,
    suspended:      users.filter(u => u.is_suspended && !u.is_admin).length,
  };

  const floorRooms = {};
  for (let f = 1; f <= TOTAL_FLOORS; f++) {
    floorRooms[f] = roomsForFloor(f);
  }

  res.render('admin/users', {
    layout:    'layout',
    pageTitle: t('adminUsersTitle'),
    users,
    stats,
    totalFloors: TOTAL_FLOORS,
    floorRooms,
  });
});

/* ── POST /admin/users/add ────────────────────────────────────────────────── */
router.post('/users/add', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;
  const { name, email, password, role, floor_id, room_id } = req.body;

  if (!name || !email || !password) {
    req.session.flash = { error: t('adminUserFieldsRequired') };
    return req.session.save(() => res.redirect('/admin/users'));
  }
  if (password.length < 8) {
    req.session.flash = { error: t('errorPasswordTooShort') };
    return req.session.save(() => res.redirect('/admin/users'));
  }

  const existing = await db().queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing) {
    req.session.flash = { error: t('errorEmailTaken') };
    return req.session.save(() => res.redirect('/admin/users'));
  }

  const hash = await new Promise(resolve => resolve(bcrypt.hashSync(password, 10)));
  const floorId = floor_id ? parseInt(floor_id) : null;
  const roomId  = room_id  ? parseInt(room_id)  : null;
  const isFloorSpeaker = role === 'floor_speaker';

  await db().run(
    `INSERT INTO users (email, password_hash, name, role, floor_id, room_id, is_onboarded, managed_floor_id, language)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'de')`,
    [
      email.toLowerCase().trim(),
      hash,
      name.trim(),
      role || 'student',
      floorId,
      isFloorSpeaker ? null : roomId,
      isFloorSpeaker ? floorId : null,
    ]
  );

  req.session.flash = { success: t('adminUserAdded') };
  req.session.save(() => res.redirect('/admin/users'));
});

/* ── POST /admin/users/:id/suspend ───────────────────────────────────────── */
router.post('/users/:id/suspend', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;
  const userId = parseInt(req.params.id);

  const user = await db().queryOne('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user || user.is_admin) {
    req.session.flash = { error: t('adminCannotModifyAdmin') };
    return req.session.save(() => res.redirect('/admin/users'));
  }

  const newVal = user.is_suspended ? 0 : 1;
  await db().run('UPDATE users SET is_suspended = $1 WHERE id = $2', [newVal, userId]);
  invalidateUserCache(userId);

  req.session.flash = { success: newVal ? t('adminUserRestricted') : t('adminUserUnrestricted') };
  req.session.save(() => res.redirect('/admin/users'));
});

/* ── POST /admin/users/:id/delete ────────────────────────────────────────── */
router.post('/users/:id/delete', requireAuth, requireOnboarded, requireAdmin, async (req, res) => {
  const t = res.locals.t;
  const userId = parseInt(req.params.id);
  const adminId = res.locals.user.id;

  if (userId === adminId) {
    req.session.flash = { error: t('adminCannotDeleteSelf') };
    return req.session.save(() => res.redirect('/admin/users'));
  }

  const user = await db().queryOne('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user || user.is_admin) {
    req.session.flash = { error: t('adminCannotModifyAdmin') };
    return req.session.save(() => res.redirect('/admin/users'));
  }

  await db().run('DELETE FROM disposal_events WHERE user_id = $1', [userId]);
  await db().run('DELETE FROM bin_alerts WHERE user_id = $1', [userId]);
  if (user.floor_id && user.room_id) {
    await db().run('DELETE FROM room_holidays WHERE floor_id = $1 AND room_number = $2',      [user.floor_id, user.room_id]);
    await db().run('DELETE FROM pending_duty_queue WHERE floor_id = $1 AND room_number = $2', [user.floor_id, user.room_id]);
    await db().run('DELETE FROM duty_schedule WHERE floor_id = $1 AND assigned_room = $2',    [user.floor_id, user.room_id]);
  }
  await db().run('DELETE FROM users WHERE id = $1', [userId]);
  invalidateUserCache(userId);

  req.session.flash = { success: t('adminUserDeleted') };
  req.session.save(() => res.redirect('/admin/users'));
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
