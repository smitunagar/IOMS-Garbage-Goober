'use strict';
/*
 * Duty-rotation engine - stateful, holiday-aware weekly rotation.
 *
 * Rules:
 *  1. Rooms rotate in ascending room-number order per floor.
 *  2. If a room is on holiday during its assigned week it is skipped and
 *     placed in a FIFO pending queue.
 *  3. Pending rooms are reassigned FIFO before normal rotation resumes.
 *  4. Once Mon 00:00 passes, duty is locked in duty_schedule (week-lock).
 *     Only adminOverrideDuty() may change a locked week.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// ─── Pure week utilities ──────────────────────────────────────────────────────

function getWeekStart(date) {
  if (!date) date = new Date();
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(date) {
  const ws = getWeekStart(date || new Date());
  ws.setUTCDate(ws.getUTCDate() + 6);
  ws.setUTCHours(23, 59, 59, 999);
  return ws;
}

function getNextWeekStart(date) {
  const ws = getWeekStart(date || new Date());
  ws.setUTCDate(ws.getUTCDate() + 7);
  return ws;
}

function weeksPassed(anchorMonday, ref) {
  if (!ref) ref = new Date();
  const diff = ref.getTime() - new Date(anchorMonday).getTime();
  return diff < 0 ? 0 : Math.floor(diff / MS_PER_WEEK);
}

function daysRemainingInWeek(date) {
  const now = date || new Date();
  const end = getWeekEnd(now);
  return Math.ceil((end - now) / (24 * 60 * 60 * 1000));
}

function getWeekStartStr(date) {
  return getWeekStart(date || new Date()).toISOString().slice(0, 10);
}

function weekStartToEndStr(weekStartStr) {
  const d = new Date(weekStartStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function isoWeekNumber(date) {
  if (!date) date = new Date();
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function fmtDayMonth(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm;
}

function fmtDate(date) {
  return fmtDayMonth(date) + '.' + date.getFullYear();
}

function fmtTime(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function fmtDateTime(date) {
  return fmtDate(date) + ' ' + fmtTime(date);
}

function weekRangeLabel(date) {
  if (!date) date = new Date();
  const ws = getWeekStart(date);
  const we = getWeekEnd(date);
  return 'KW ' + isoWeekNumber(ws) + ' (' + fmtDayMonth(ws) + ' \u2013 ' + fmtDate(we) + ')';
}

// ─── Holiday check ────────────────────────────────────────────────────────────

async function isRoomOnHoliday(db, roomNumber, floorId, weekStartStr, weekEndStr) {
  const row = await db.queryOne(
    'SELECT id FROM room_holidays WHERE room_number = $1 AND floor_id = $2 AND start_date <= $3 AND end_date >= $4 LIMIT 1',
    [roomNumber, floorId, weekEndStr, weekStartStr]
  );
  return !!row;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _storeDutySchedule(db, floorId, weekStart, assignedRoom, isOverride, isFromPending) {
  await db.run(
    'INSERT INTO duty_schedule (floor_id, week_start, assigned_room, is_override, is_from_pending) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [floorId, weekStart, assignedRoom, isOverride ? 1 : 0, isFromPending ? 1 : 0]
  );
}

// ─── Core computation ─────────────────────────────────────────────────────────

async function _computeDuty(db, floorId, weekStartStr, activeRooms, anchor, opts) {
  const store       = !!(opts && opts.store);
  const pendingSnap = (opts && opts.pendingSnap) || [];
  const lastNormRef = (opts && opts.lastNormRef) || { value: null };

  if (!activeRooms.length) return null;
  const weekEndStr = weekStartToEndStr(weekStartStr);

  // Step 1: FIFO pending queue
  const pendingRows = store
    ? await db.query(
        'SELECT * FROM pending_duty_queue WHERE floor_id = $1 AND is_processed = 0 ORDER BY queued_at ASC, id ASC',
        [floorId]
      )
    : pendingSnap;

  for (let pi = 0; pi < pendingRows.length; pi++) {
    const entry = pendingRows[pi];
    if (!activeRooms.includes(entry.room_number)) continue;
    if (!(await isRoomOnHoliday(db, entry.room_number, floorId, weekStartStr, weekEndStr))) {
      if (store) {
        await db.run(
          'UPDATE pending_duty_queue SET is_processed = 1, assigned_week_start = $1 WHERE id = $2',
          [weekStartStr, entry.id]
        );
        await _storeDutySchedule(db, floorId, weekStartStr, entry.room_number, false, true);
      } else {
        pendingRows.splice(pi, 1);
      }
      return entry.room_number;
    }
  }

  // Step 2: Base rotation - advance from last normal-rotation room
  let startIdx;
  if (store) {
    const lastNorm = await db.queryOne(
      'SELECT assigned_room FROM duty_schedule WHERE floor_id = $1 AND is_from_pending = 0 AND is_override = 0 ORDER BY week_start DESC LIMIT 1',
      [floorId]
    );
    if (lastNorm) {
      const idx = activeRooms.indexOf(lastNorm.assigned_room);
      startIdx = idx === -1 ? 0 : (idx + 1) % activeRooms.length;
    } else {
      const ref = new Date(weekStartStr + 'T12:00:00');
      startIdx = weeksPassed(anchor.anchor_start_monday, ref) % activeRooms.length;
    }
  } else {
    if (lastNormRef.value !== null) {
      const idx = activeRooms.indexOf(lastNormRef.value);
      startIdx = idx === -1 ? 0 : (idx + 1) % activeRooms.length;
    } else {
      const ref = new Date(weekStartStr + 'T12:00:00');
      startIdx = weeksPassed(anchor.anchor_start_monday, ref) % activeRooms.length;
    }
  }

  for (let i = 0; i < activeRooms.length; i++) {
    const idx  = (startIdx + i) % activeRooms.length;
    const room = activeRooms[idx];

    if (!(await isRoomOnHoliday(db, room, floorId, weekStartStr, weekEndStr))) {
      if (store) {
        await _storeDutySchedule(db, floorId, weekStartStr, room, false, false);
      } else {
        lastNormRef.value = room;
      }
      return room;
    } else {
      if (store) {
        const exists = await db.queryOne(
          'SELECT id FROM pending_duty_queue WHERE floor_id = $1 AND room_number = $2 AND skipped_week_start = $3 AND is_processed = 0',
          [floorId, room, weekStartStr]
        );
        if (!exists) {
          await db.run(
            'INSERT INTO pending_duty_queue (floor_id, room_number, skipped_week_start) VALUES ($1, $2, $3)',
            [floorId, room, weekStartStr]
          );
        }
      } else {
        if (!pendingSnap.some(function(p) { return p.room_number === room && !p.is_processed; })) {
          pendingSnap.push({ room_number: room, queued_at: weekStartStr, is_processed: 0 });
        }
      }
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getDutyForWeek(db, floorId, weekStartStr) {
  const existing = await db.queryOne(
    'SELECT assigned_room FROM duty_schedule WHERE floor_id = $1 AND week_start = $2',
    [floorId, weekStartStr]
  );
  if (existing) return existing.assigned_room;

  const anchor = await db.queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]);
  if (!anchor) return null;

  if (anchor.manual_override_room_id) {
    await _storeDutySchedule(db, floorId, weekStartStr, anchor.manual_override_room_id, true, false);
    return anchor.manual_override_room_id;
  }

  const activeRooms = (await db.query(
    'SELECT room_number FROM rooms WHERE floor_id = $1 AND is_active = 1 ORDER BY room_number',
    [floorId]
  )).map(function(r) { return r.room_number; });

  if (!activeRooms.length) return null;
  return _computeDuty(db, floorId, weekStartStr, activeRooms, anchor, { store: true });
}

async function currentDutyRoom(db, floorId) {
  return getDutyForWeek(db, floorId, getWeekStartStr());
}

async function adminOverrideDuty(db, floorId, weekStartStr, roomNumber) {
  await db.run('DELETE FROM duty_schedule WHERE floor_id = $1 AND week_start = $2', [floorId, weekStartStr]);
  await _storeDutySchedule(db, floorId, weekStartStr, roomNumber, true, false);
}

async function invalidateFutureSchedule(db, floorId) {
  await db.run(
    'DELETE FROM duty_schedule WHERE floor_id = $1 AND week_start > $2',
    [floorId, getWeekStartStr()]
  );
}

async function upcomingDutyEntries(db, floorId, weeksAhead) {
  if (!weeksAhead) weeksAhead = 4;
  const anchor = await db.queryOne('SELECT * FROM duty_anchors WHERE floor_id = $1', [floorId]);
  if (!anchor) return [];

  const activeRooms = (await db.query(
    'SELECT room_number FROM rooms WHERE floor_id = $1 AND is_active = 1 ORDER BY room_number',
    [floorId]
  )).map(function(r) { return r.room_number; });
  if (!activeRooms.length) return [];

  const pendingSnap = await db.query(
    'SELECT * FROM pending_duty_queue WHERE floor_id = $1 AND is_processed = 0 ORDER BY queued_at ASC, id ASC',
    [floorId]
  );

  const lastNormEntry = await db.queryOne(
    'SELECT assigned_room FROM duty_schedule WHERE floor_id = $1 AND is_from_pending = 0 AND is_override = 0 ORDER BY week_start DESC LIMIT 1',
    [floorId]
  );
  const lastNormRef = { value: lastNormEntry ? lastNormEntry.assigned_room : null };

  const entries = [];
  for (let i = 1; i <= weeksAhead; i++) {
    const refDate = new Date();
    refDate.setDate(refDate.getDate() + i * 7);
    const weekStart    = getWeekStart(refDate);
    const weekEnd      = getWeekEnd(refDate);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const locked = await db.queryOne(
      'SELECT assigned_room, is_from_pending FROM duty_schedule WHERE floor_id = $1 AND week_start = $2',
      [floorId, weekStartStr]
    );

    let room;
    if (locked) {
      room = locked.assigned_room;
      if (!locked.is_from_pending) lastNormRef.value = room;
    } else {
      room = await _computeDuty(db, floorId, weekStartStr, activeRooms, anchor, {
        store: false,
        pendingSnap: pendingSnap,
        lastNormRef: lastNormRef,
      });
    }

    entries.push({ weekStart: weekStart, weekEnd: weekEnd, room: room, label: weekRangeLabel(weekStart) });
  }
  return entries;
}

module.exports = {
  getWeekStart,
  getWeekEnd,
  getNextWeekStart,
  weeksPassed,
  daysRemainingInWeek,
  getWeekStartStr,
  weekStartToEndStr,
  isoWeekNumber,
  fmtDayMonth,
  fmtDate,
  fmtTime,
  fmtDateTime,
  weekRangeLabel,
  getDutyForWeek,
  currentDutyRoom,
  adminOverrideDuty,
  invalidateFutureSchedule,
  upcomingDutyEntries,
  isRoomOnHoliday,
};
