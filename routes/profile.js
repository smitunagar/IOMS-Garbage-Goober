'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database').getDb;

const router = express.Router();

/* ── Require login ─────────────────────────────────────────────────────── */
router.use((req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
});

/* ── GET /profile ──────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  res.render('profile/index', { layout: 'layout', pageTitle: res.locals.t('profileTitle') });
});

/* ── POST /profile/change-password ────────────────────────────────────── */
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const t = res.locals.t;

  if (!currentPassword) {
    req.session.flash = { error: t('errorCurrentPasswordWrong') };
    return req.session.save(() => res.redirect('/profile'));
  }

  let dbUser;
  try {
    dbUser = await db().queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
  } catch (err) {
    req.session.flash = { error: t('errorGeneric', { error: 'Database error' }) };
    return req.session.save(() => res.redirect('/profile'));
  }

  if (!dbUser || !bcrypt.compareSync(currentPassword, dbUser.password_hash)) {
    req.session.flash = { error: t('errorCurrentPasswordWrong') };
    return req.session.save(() => res.redirect('/profile'));
  }
  if (!newPassword || newPassword.length < 8) {
    req.session.flash = { error: t('errorPasswordTooShort') };
    return req.session.save(() => res.redirect('/profile'));
  }
  if (newPassword !== confirmPassword) {
    req.session.flash = { error: t('errorPasswordMismatch') };
    return req.session.save(() => res.redirect('/profile'));
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db().run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, dbUser.id]);

  req.session.flash = { success: t('changePasswordSuccess') };
  req.session.save(() => res.redirect('/profile'));
});

module.exports = router;
