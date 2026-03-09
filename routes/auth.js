const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database').getDb;
const { TOTAL_FLOORS, ROOMS_PER_FLOOR, roomsForFloor } = require('../utils/constants');

const FLOOR_SPEAKER_CODE = 'WebMeister360_1_FS_425';

const router = express.Router();

/* ── GET /login ──────────────────────────────────────────────────────────── */
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/home');
  res.render('auth/login', { layout: 'layout', pageTitle: 'Login', query: req.query });
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

  // ── Floor Speaker registration branch ─────────────────────────────────────
  if (req.body.is_floor_speaker === 'on') {
    const fsCode  = (req.body.fs_code  || '').trim();
    const fsFloor = parseInt(req.body.fs_floor);

    if (fsCode !== FLOOR_SPEAKER_CODE) {
      req.session.flash = { error: t('errorInvalidFloorSpeakerCode') };
      return req.session.save(() => res.redirect('/signup'));
    }
    if (!fsFloor || fsFloor < 1 || fsFloor > TOTAL_FLOORS) {
      req.session.flash = { error: t('errorFloorRequired') };
      return req.session.save(() => res.redirect('/signup'));
    }

    let fsExists;
    try {
      fsExists = await db().queryOne(
        "SELECT id FROM users WHERE role = 'floor_speaker' AND managed_floor_id = $1",
        [fsFloor]
      );
    } catch (err) {
      console.error('Floor speaker check error:', err);
      req.session.flash = { error: t('errorGeneric', { error: 'Database error' }) };
      return req.session.save(() => res.redirect('/signup'));
    }

    if (fsExists) {
      req.session.flash = { error: t('errorFloorSpeakerExists') };
      return req.session.save(() => res.redirect('/signup'));
    }

    try {
      const hash = bcrypt.hashSync(password, 10);
      const row = await db().queryOne(
        `INSERT INTO users (email, password_hash, name, role, managed_floor_id, floor_id, is_onboarded, language)
         VALUES ($1, $2, $3, 'floor_speaker', $4, $4, 1, $5) RETURNING id`,
        [email.toLowerCase().trim(), hash, name.trim(), fsFloor, req.body.language || 'de']
      );
      req.session.userId = row.id;
      req.session.language = req.body.language || 'de';
      return req.session.save(() => res.redirect('/home'));
    } catch (err) {
      console.error('Floor speaker signup insert error:', err);
      req.session.flash = { error: t('errorGeneric', { error: err.message }) };
      return req.session.save(() => res.redirect('/signup'));
    }
  }

  // ── Normal student registration ───────────────────────────────────────────
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
/* ── POST /account/delete ────────────────────────────────────────────────── */
router.post('/account/delete', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const t = res.locals.t;
  const { password } = req.body;
  const userId = req.session.userId;

  if (!password) {
    req.session.flash = { error: t('deleteAccountPasswordRequired') };
    return req.session.save(() => res.redirect(req.headers.referer || '/home'));
  }

  let user;
  try {
    user = await db().queryOne('SELECT * FROM users WHERE id = $1', [userId]);
  } catch (err) {
    console.error('Delete account fetch error:', err);
    req.session.flash = { error: t('errorGeneric', { error: 'Database error' }) };
    return req.session.save(() => res.redirect(req.headers.referer || '/home'));
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { error: t('deleteAccountWrongPassword') };
    return req.session.save(() => res.redirect(req.headers.referer || '/home'));
  }

  if (user.is_admin) {
    req.session.flash = { error: t('deleteAccountAdminNotAllowed') };
    return req.session.save(() => res.redirect(req.headers.referer || '/home'));
  }

  try {
    // Delete FK-constrained records first
    await db().run('DELETE FROM disposal_events WHERE user_id = $1', [userId]);
    await db().run('DELETE FROM bin_alerts WHERE user_id = $1', [userId]);
    // Clean up duty-related records for this room
    if (user.floor_id && user.room_id) {
      await db().run(
        'DELETE FROM room_holidays WHERE floor_id = $1 AND room_id = $2',
        [user.floor_id, user.room_id]
      );
      await db().run(
        'DELETE FROM pending_duty_queue WHERE floor_id = $1 AND room_id = $2',
        [user.floor_id, user.room_id]
      );
      await db().run(
        'DELETE FROM duty_schedule WHERE floor_id = $1 AND room_id = $2',
        [user.floor_id, user.room_id]
      );
    }
    // Finally delete the user
    await db().run('DELETE FROM users WHERE id = $1', [userId]);
  } catch (err) {
    console.error('Delete account DB error:', err);
    req.session.flash = { error: t('errorGeneric', { error: err.message }) };
    return req.session.save(() => res.redirect(req.headers.referer || '/home'));
  }

  req.session.destroy(() => res.redirect('/login?deleted=1'));
});
/* ── GET /logout ─────────────────────────────────────────────────────────── */
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
