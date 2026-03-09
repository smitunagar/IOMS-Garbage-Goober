'use strict';
const express = require('express');
const db = require('../config/database').getDb;
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { sendWhatsApp } = require('../utils/whatsapp');

const router = express.Router();

/* ── GET /profile ────────────────────────────────────────────────────────── */
router.get('/', requireAuth, requireOnboarded, (req, res) => {
  res.render('profile/settings', {
    layout: 'layout',
    pageTitle: 'Settings',
  });
});

/* ── POST /profile/whatsapp ──────────────────────────────────────────────── */
router.post('/whatsapp', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  let { phone, whatsapp_key } = req.body;

  phone = (phone || '').trim();
  whatsapp_key = (whatsapp_key || '').trim();

  await db().run(
    'UPDATE users SET phone = $1, whatsapp_key = $2 WHERE id = $3',
    [phone || null, whatsapp_key || null, user.id]
  );

  req.session.flash = { success: 'WhatsApp settings saved!' };
  res.redirect('/profile');
});

/* ── POST /profile/whatsapp/test ─────────────────────────────────────────── */
router.post('/whatsapp/test', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;

  // Re-fetch user to get latest phone/whatsapp_key
  const freshUser = await db().queryOne('SELECT * FROM users WHERE id = $1', [user.id]);

  if (!freshUser.phone || !freshUser.whatsapp_key) {
    req.session.flash = { error: 'Save your phone number and API key first.' };
    return res.redirect('/profile');
  }

  const ok = await sendWhatsApp(
    freshUser.phone,
    freshUser.whatsapp_key,
    `✅ Test from Garbage Goober!\n\nHey ${freshUser.name}, your WhatsApp notifications are working perfectly. 🎉\n– IOMS`
  );

  if (ok) {
    req.session.flash = { success: 'Test message sent! Check your WhatsApp.' };
  } else {
    req.session.flash = { error: 'Message failed. Double-check your phone number and API key.' };
  }
  res.redirect('/profile');
});

/* ── POST /profile/name ──────────────────────────────────────────────────── */
router.post('/name', requireAuth, requireOnboarded, async (req, res) => {
  const user = res.locals.user;
  const name = (req.body.name || '').trim();

  if (!name) {
    req.session.flash = { error: 'Name cannot be empty.' };
    return res.redirect('/profile');
  }

  await db().run('UPDATE users SET name = $1 WHERE id = $2', [name, user.id]);
  req.session.flash = { success: 'Name updated!' };
  res.redirect('/profile');
});

module.exports = router;
