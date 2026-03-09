'use strict';
const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { invalidateFutureSchedule, fmtDate } = require('../utils/rotation');

const router = express.Router();

/* ── GET /holidays ───────────────────────────────────────────────────────── */
router.get('/', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const t    = res.locals.t;

  const holidays = await db().query(
    `SELECT * FROM room_holidays
     WHERE room_number = $1 AND floor_id = $2
     ORDER BY start_date DESC`,
    [user.room_id, user.floor_id]
  );

  const today = new Date().toISOString().slice(0, 10);

  // Attach a status to each for display
  const tagged = holidays.map(h => {
    let status;
    if (h.end_date < today)        status = 'past';
    else if (h.start_date <= today) status = 'active';
    else                            status = 'upcoming';
    return { ...h, status };
  });

  res.render('holidays/index', {
    layout:    'layout',
    pageTitle: t('holidayPageTitle'),
    holidays:  tagged,
    today,
    fmtDate,
  });
});

/* ── POST /holidays/request ─────────────────────────────────────────────── */
router.post('/request', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const t    = res.locals.t;
  const { startDate, endDate, note } = req.body;

  const today = new Date().toISOString().slice(0, 10);

  if (!startDate || !endDate) {
    req.session.flash = { error: t('holidayFieldsRequired') };
    return res.redirect('/holidays');
  }
  if (startDate < today) {
    req.session.flash = { error: t('holidayStartMustBeFuture') };
    return res.redirect('/holidays');
  }
  if (endDate < startDate) {
    req.session.flash = { error: t('holidayEndBeforeStart') };
    return res.redirect('/holidays');
  }

  await db().run(
    `INSERT INTO room_holidays (room_number, floor_id, start_date, end_date, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.room_id, user.floor_id, startDate, endDate, note || null, user.name]
  );

  // Invalidate future duty schedule so rotation recalculates around this holiday
  await invalidateFutureSchedule(db(), user.floor_id);

  req.session.flash = { success: t('holidayRequestSuccess') };
  res.redirect('/holidays');
});

/* ── POST /holidays/cancel/:id ──────────────────────────────────────────── */
router.post('/cancel/:id', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const t    = res.locals.t;
  const id   = parseInt(req.params.id);

  // Only allow cancelling own room's future/active holidays
  const holiday = await db().queryOne(
    'SELECT * FROM room_holidays WHERE id = $1 AND room_number = $2 AND floor_id = $3',
    [id, user.room_id, user.floor_id]
  );

  if (!holiday) {
    req.session.flash = { error: 'Not found.' };
    return res.redirect('/holidays');
  }

  await db().run('DELETE FROM room_holidays WHERE id = $1', [id]);
  await invalidateFutureSchedule(db(), user.floor_id);

  req.session.flash = { success: t('holidayCancelSuccess') };
  res.redirect('/holidays');
});

module.exports = router;
