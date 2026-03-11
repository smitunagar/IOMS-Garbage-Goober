'use strict';
/* ── Push Notification Routes ─────────────────────────────────────────────────
   GET  /push/vapid-public-key       → public VAPID key for client subscription
   POST /push/subscribe              → save Web Push subscription
   POST /push/register-apns          → save iOS APNs device token
   DELETE /push/unsubscribe          → remove subscription
   GET  /push/weekly-duty-reminder   → Vercel Cron (Mon 8am) – duty notifications
   POST /push/broadcast              → admin: push to all users
   ─────────────────────────────────────────────────────────────────────────── */

const express  = require('express');
const router   = express.Router();
const db       = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { sendPushToUsers, sendPushToAll } = require('../utils/push');
const { getDutyForWeek, getWeekStartStr } = require('../utils/rotation');
const { TOTAL_FLOORS, roomLabel }         = require('../utils/constants');

// ── GET /push/vapid-public-key ────────────────────────────────────────────────
router.get('/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// ── POST /push/subscribe (Web Push VAPID) ────────────────────────────────────
router.post('/subscribe', requireAuth, requireOnboarded, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.json({ ok: false });

  const user = res.locals.user;
  await db().run(
    `INSERT INTO push_subscriptions (user_id, floor_id, platform, endpoint, subscription_data)
     VALUES ($1, $2, 'web', $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = $1, floor_id = $2, subscription_data = $4, updated_at = NOW()`,
    [user.id, user.floor_id, subscription.endpoint, JSON.stringify(subscription)]
  );
  res.json({ ok: true });
});

// ── POST /push/register-apns (iOS native WKWebView) ──────────────────────────
router.post('/register-apns', requireAuth, requireOnboarded, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ ok: false });

  const user = res.locals.user;
  await db().run(
    `INSERT INTO push_subscriptions (user_id, floor_id, platform, endpoint, apns_token)
     VALUES ($1, $2, 'apns', $3, $3)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = $1, floor_id = $2, apns_token = $3, updated_at = NOW()`,
    [user.id, user.floor_id, token]
  );
  res.json({ ok: true });
});

// ── DELETE /push/unsubscribe ──────────────────────────────────────────────────
router.delete('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await db().run('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  } else {
    await db().run('DELETE FROM push_subscriptions WHERE user_id = $1', [req.session.userId]);
  }
  res.json({ ok: true });
});

// ── GET /push/weekly-duty-reminder (Vercel Cron – Monday 8:00 UTC) ───────────
router.get('/weekly-duty-reminder', async (req, res) => {
  // Verify Vercel cron secret (set automatically by Vercel, or via CRON_SECRET env var)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false });
  }

  const weekStart = getWeekStartStr();
  let sent = 0;

  for (let floorId = 1; floorId <= TOTAL_FLOORS; floorId++) {
    try {
      const dutyRoomId = await getDutyForWeek(db(), floorId, weekStart);
      if (!dutyRoomId) continue;

      const dutyUser = await db().queryOne(
        'SELECT id FROM users WHERE floor_id = $1 AND room_id = $2 AND is_onboarded = 1 LIMIT 1',
        [floorId, dutyRoomId]
      );
      if (!dutyUser) continue;

      await sendPushToUsers(db(), [dutyUser.id], {
        title: '🗑️ Trash Duty This Week',
        body:  `Room ${roomLabel(dutyRoomId)} – it's your turn to handle the bins on Floor ${floorId}!`,
        url:   '/home',
      });
      sent++;
    } catch (err) {
      console.error(`[Cron] Weekly push floor ${floorId}:`, err.message);
    }
  }

  res.json({ ok: true, sent });
});

// ── POST /push/broadcast (Admin only) ────────────────────────────────────────
router.post('/broadcast', requireAuth, async (req, res) => {
  const user = res.locals.user;
  if (!user?.is_admin) return res.status(403).json({ ok: false });

  const { title, body } = req.body;
  if (!title) return res.json({ ok: false, error: 'Title required' });

  await sendPushToAll(db(), { title, body: body || '', url: '/home' });
  res.json({ ok: true });
});

module.exports = router;
