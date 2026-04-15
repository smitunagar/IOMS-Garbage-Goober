const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/database').getDb;
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { TOTAL_FLOORS, ROOMS_PER_FLOOR, roomsForFloor } = require('../utils/constants');

const FLOOR_SPEAKER_CODE = 'WebMeister360_1_FS_425';

/* ── Dorm WiFi restriction ────────────────────────────────────────────────── */
// Only residents connected to the dormitory WiFi (public IP 77.73.111.240)
// may create a new account. Vercel sets the real client IP in x-forwarded-for.
const DORM_WIFI_IP = '77.73.111.240';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || '';
}

async function createEmailToken(userId, type, expiresInMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + expiresInMs);
  // Invalidate any previous tokens of the same type for this user
  await db().run('DELETE FROM email_tokens WHERE user_id = $1 AND type = $2', [userId, type]);
  await db().run(
    'INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, token, type, expires]
  );
  return token;
}

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

  // ── Email verification check ──────────────────────────────────────────────
  if (!user.is_email_verified) {
    req.session.flash = { error: t('emailNotVerifiedError') };
    return req.session.save(() =>
      res.redirect(`/verify-email-sent?email=${encodeURIComponent(user.email)}`)
    );
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
  if (getClientIp(req) !== DORM_WIFI_IP) {
    res.locals.flash = { error: res.locals.t('errorDormWifiRequired') };
  }
  res.render('auth/signup', { layout: 'layout', pageTitle: 'Sign Up' });
});

/* ── POST /signup ────────────────────────────────────────────────────────── */
router.post('/signup', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  const t = res.locals.t;

  // ── Dorm WiFi check ────────────────────────────────────────────────────────
  if (getClientIp(req) !== DORM_WIFI_IP) {
    req.session.flash = { error: t('errorDormWifiRequired') };
    return req.session.save(() => res.redirect('/signup'));
  }

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
    const fsRoom = parseInt(req.body.fs_room);
    if (!fsRoom) {
      req.session.flash = { error: t('errorRoomRequired') };
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
        `INSERT INTO users (email, password_hash, name, role, managed_floor_id, floor_id, room_id, is_onboarded, language, is_email_verified)
         VALUES ($1, $2, $3, 'floor_speaker', $4, $4, $5, 1, $6, 0) RETURNING id`,
        [email.toLowerCase().trim(), hash, name.trim(), fsFloor, fsRoom, req.body.language || 'de']
      );
      req.session.language = req.body.language || 'de';
      const token = await createEmailToken(row.id, 'verify', 24 * 60 * 60 * 1000);
      try { await sendVerificationEmail(email.toLowerCase().trim(), name.trim(), token); } catch (e) { console.error('Verify email error:', e); }
      return req.session.save(() => res.redirect(`/verify-email-sent?email=${encodeURIComponent(email.toLowerCase().trim())}`));
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
      'INSERT INTO users (email, password_hash, name, is_email_verified) VALUES ($1, $2, $3, 0) RETURNING id',
      [email.toLowerCase().trim(), hash, name.trim()]
    );
    req.session.language = req.body.language || 'de';
    const token = await createEmailToken(row.id, 'verify', 24 * 60 * 60 * 1000);
    try { await sendVerificationEmail(email.toLowerCase().trim(), name.trim(), token); } catch (e) { console.error('Verify email error:', e); }
    req.session.save(() => res.redirect(`/verify-email-sent?email=${encodeURIComponent(email.toLowerCase().trim())}`));
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
  const lockedFloor = (user && user.role === 'floor_speaker') ? user.floor_id : null;
  res.render('auth/onboarding', {
    layout: 'layout',
    pageTitle: 'Onboarding',
    totalFloors: TOTAL_FLOORS,
    roomsPerFloor: ROOMS_PER_FLOOR,
    user,
    lockedFloor,
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

  try {
    // Delete FK-constrained records first
    await db().run('DELETE FROM disposal_events WHERE user_id = $1', [userId]);
    await db().run('DELETE FROM bin_alerts WHERE user_id = $1', [userId]);
    // Clean up duty-related records for this room
    if (user.floor_id && user.room_id) {
      await db().run(
        'DELETE FROM room_holidays WHERE floor_id = $1 AND room_number = $2',
        [user.floor_id, user.room_id]
      );
      await db().run(
        'DELETE FROM pending_duty_queue WHERE floor_id = $1 AND room_number = $2',
        [user.floor_id, user.room_id]
      );
      await db().run(
        'DELETE FROM duty_schedule WHERE floor_id = $1 AND assigned_room = $2',
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

/* ───────────────────────────────────────────────────────────────
   EMAIL VERIFICATION
────────────────────────────────────────────────────────────── */

/* GET /verify-email-sent  – "check your inbox" holding page */
router.get('/verify-email-sent', (req, res) => {
  const email = req.query.email || '';
  res.render('auth/email-sent', { layout: 'layout', pageTitle: 'Verify Email', email });
});

/* POST /verify-email/resend  – resend a fresh token */
router.post('/verify-email/resend', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const t = res.locals.t;
  const user = await db().queryOne(
    'SELECT * FROM users WHERE email = $1 AND is_email_verified = 0', [email]
  );
  if (!user) {
    req.session.flash = { error: t('resendVerificationNotFound') };
    return req.session.save(() => res.redirect(`/verify-email-sent?email=${encodeURIComponent(email)}`));
  }
  const token = await createEmailToken(user.id, 'verify', 24 * 60 * 60 * 1000);
  try { await sendVerificationEmail(email, user.name, token); } catch (e) { console.error('Resend verify error:', e); }
  req.session.flash = { success: t('resendVerificationSuccess') };
  req.session.save(() => res.redirect(`/verify-email-sent?email=${encodeURIComponent(email)}`));
});

/* GET /verify-email?token=xxx  – activate account */
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  const t = res.locals.t;
  if (!token) return res.redirect('/login');

  const row = await db().queryOne(
    `SELECT et.*, u.id AS uid FROM email_tokens et
     JOIN users u ON u.id = et.user_id
     WHERE et.token = $1 AND et.type = 'verify' AND et.expires_at > NOW()`,
    [token]
  );
  if (!row) {
    req.session.flash = { error: t('emailVerificationInvalid') };
    return req.session.save(() => res.redirect('/login'));
  }

  await db().run('UPDATE users SET is_email_verified = 1 WHERE id = $1', [row.uid]);
  await db().run('DELETE FROM email_tokens WHERE id = $1', [row.id]);

  req.session.flash = { success: t('emailVerificationSuccess') };
  req.session.save(() => res.redirect('/login'));
});

/* ───────────────────────────────────────────────────────────────
   FORGOT / RESET PASSWORD
────────────────────────────────────────────────────────────── */

/* GET /forgot-password */
router.get('/forgot-password', (req, res) => {
  if (req.session.userId) return res.redirect('/home');
  res.render('auth/forgot-password', { layout: 'layout', pageTitle: 'Forgot Password' });
});

/* POST /forgot-password */
router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const t = res.locals.t;
  // Always show the same success message to prevent email enumeration
  const done = () => {
    req.session.flash = { success: t('resetLinkSentMessage') };
    return req.session.save(() => res.redirect('/forgot-password'));
  };

  const user = await db().queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) return done();

  const token = await createEmailToken(user.id, 'reset', 60 * 60 * 1000); // 1 hour
  try { await sendPasswordResetEmail(email, user.name, token); } catch (e) { console.error('Reset email error:', e); }
  return done();
});

/* GET /reset-password?token=xxx */
router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  const t = res.locals.t;
  if (!token) return res.redirect('/forgot-password');

  const row = await db().queryOne(
    `SELECT et.id FROM email_tokens et
     WHERE et.token = $1 AND et.type = 'reset' AND et.expires_at > NOW()`,
    [token]
  );
  if (!row) {
    req.session.flash = { error: t('resetPasswordInvalid') };
    return req.session.save(() => res.redirect('/forgot-password'));
  }
  res.render('auth/reset-password', { layout: 'layout', pageTitle: 'Reset Password', token });
});

/* POST /reset-password */
router.post('/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;
  const t = res.locals.t;

  const row = await db().queryOne(
    `SELECT et.*, u.id AS uid FROM email_tokens et
     JOIN users u ON u.id = et.user_id
     WHERE et.token = $1 AND et.type = 'reset' AND et.expires_at > NOW()`,
    [token]
  );
  if (!row) {
    req.session.flash = { error: t('resetPasswordInvalid') };
    return req.session.save(() => res.redirect('/forgot-password'));
  }
  if (!newPassword || newPassword.length < 8) {
    req.session.flash = { error: t('errorPasswordTooShort') };
    return req.session.save(() => res.redirect(`/reset-password?token=${token}`));
  }
  if (newPassword !== confirmPassword) {
    req.session.flash = { error: t('errorPasswordMismatch') };
    return req.session.save(() => res.redirect(`/reset-password?token=${token}`));
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db().run('UPDATE users SET password_hash = $1, is_email_verified = 1 WHERE id = $2', [hash, row.uid]);
  await db().run('DELETE FROM email_tokens WHERE user_id = $1 AND type = $2', [row.uid, 'reset']);

  req.session.flash = { success: t('resetPasswordSuccess') };
  req.session.save(() => res.redirect('/login'));
});

module.exports = router;
