const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database').getDb;
const { TOTAL_FLOORS, ROOMS_PER_FLOOR, roomsForFloor } = require('../utils/constants');

const router = express.Router();

/* ── GET /login ──────────────────────────────────────────────────────────── */
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/home');
  res.render('auth/login', { layout: 'layout', pageTitle: 'Login' });
});

/* ── POST /login ─────────────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const t = res.locals.t;

  if (!email || !password) {
    req.session.flash = { error: t('errorInvalidCredentials') };
    return req.session.save(() => res.redirect('/login'));
  }

  let user;
  try {
    user = await db().queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  } catch (err) {
    console.error('Login DB error:', err);
    req.session.flash = { error: t('errorGeneric', { error: 'Database error' }) };
    return req.session.save(() => res.redirect('/login'));
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { error: t('errorInvalidCredentials') };
    return req.session.save(() => res.redirect('/login'));
  }

  req.session.userId = user.id;
  req.session.language = user.language || 'de';

  const returnTo = req.session.returnTo || (user.is_onboarded ? '/home' : '/onboarding');
  delete req.session.returnTo;
  req.session.save(() => res.redirect(returnTo));
});

/* ── GET /signup ─────────────────────────────────────────────────────────── */
router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/home');
  res.render('auth/signup', { layout: 'layout', pageTitle: 'Sign Up' });
});

/* ── POST /signup ────────────────────────────────────────────────────────── */
router.post('/signup', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  const t = res.locals.t;

  if (!name || !name.trim()) {
    req.session.flash = { error: t('errorNameRequired') };
    return res.redirect('/signup');
  }
  if (!email || !email.trim()) {
    req.session.flash = { error: t('errorEmailRequired') };
    return res.redirect('/signup');
  }
  if (!password || password.length < 8) {
    req.session.flash = { error: t('errorPasswordTooShort') };
    return res.redirect('/signup');
  }
  if (password !== confirmPassword) {
    req.session.flash = { error: t('errorPasswordMismatch') };
    return res.redirect('/signup');
  }

  let existing;
  try {
    existing = await db().queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  } catch (err) {
    console.error('Signup DB error:', err);
    req.session.flash = { error: t('errorGeneric', { error: 'Database error' }) };
    return req.session.save(() => res.redirect('/signup'));
  }

  if (existing) {
    req.session.flash = { error: t('errorEmailTaken') };
    return req.session.save(() => res.redirect('/signup'));
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const row = await db().queryOne(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      [email.toLowerCase().trim(), hash, name.trim()]
    );

    req.session.userId = row.id;
    req.session.language = req.body.language || 'de';
    req.session.save(() => res.redirect('/onboarding'));
  } catch (err) {
    console.error('Signup insert error:', err);
    req.session.flash = { error: t('errorGeneric', { error: err.message }) };
    req.session.save(() => res.redirect('/signup'));
  }
});

/* ── GET /onboarding ─────────────────────────────────────────────────────── */
router.get('/onboarding', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = await db().queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
  if (user && user.is_onboarded) return res.redirect('/home');
  res.render('auth/onboarding', {
    layout: 'layout',
    pageTitle: 'Onboarding',
    totalFloors: TOTAL_FLOORS,
    roomsPerFloor: ROOMS_PER_FLOOR,
  });
});

/* ── POST /onboarding ────────────────────────────────────────────────────── */
router.post('/onboarding', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { floor, room } = req.body;
  const floorId = parseInt(floor);
  const roomId = parseInt(room);

  if (!floorId || floorId < 1 || floorId > TOTAL_FLOORS) {
    req.session.flash = { error: 'Invalid floor.' };
    return res.redirect('/onboarding');
  }
  if (!roomId) {
    req.session.flash = { error: 'Please select a room.' };
    return res.redirect('/onboarding');
  }

  try {
    await db().run(
      'UPDATE users SET floor_id = $1, room_id = $2, is_onboarded = 1 WHERE id = $3',
      [floorId, roomId, req.session.userId]
    );
  } catch (err) {
    console.error('Onboarding DB error:', err);
    req.session.flash = { error: 'Failed to save room selection. Please try again.' };
    return req.session.save(() => res.redirect('/onboarding'));
  }

  req.session.save(() => res.redirect('/home'));
});

/* ── POST /set-language ──────────────────────────────────────────────────── */
router.post('/set-language', async (req, res) => {
  const lang = req.body.language === 'en' ? 'en' : 'de';
  req.session.language = lang;
  if (req.session.userId) {
    await db().run('UPDATE users SET language = $1 WHERE id = $2', [lang, req.session.userId]);
  }
  res.redirect(req.headers.referer || '/');
});

/* ── GET /logout ─────────────────────────────────────────────────────────── */
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
