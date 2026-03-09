const { getDb } = require('../config/database');

// ── In-process user cache (60 s TTL) ─────────────────────────────────────────
// Avoids a SELECT on every single request when 100s of VUs are active.
const USER_CACHE_TTL_MS = 60_000;
const _userCache = new Map(); // userId → { user, expiresAt }

function _cacheGet(userId) {
  const entry = _userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _userCache.delete(userId); return null; }
  return entry.user;
}

function _cacheSet(userId, user) {
  _userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

/** Call this after any profile mutation so the next request re-fetches. */
function invalidateUserCache(userId) {
  _userCache.delete(userId);
}

/** Populate res.locals.user from session if logged in. */
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.path = req.path;

  if (req.session && req.session.userId) {
    const cached = _cacheGet(req.session.userId);
    if (cached) {
      res.locals.user = cached;
      return next();
    }
    try {
      const user = await getDb().queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      if (user) {
        res.locals.user = user;
        _cacheSet(user.id, user);
      } else {
        req.session.userId = null;
      }
    } catch (err) {
      console.error('loadUser error:', err);
    }
  }
  next();
}

/** Redirect to /login if not authenticated. Also blocks suspended accounts. */
function requireAuth(req, res, next) {
  const user = res.locals.user;
  if (!user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (user.is_suspended && !user.is_admin) {
    req.session.destroy(() => res.redirect('/login?suspended=1'));
    return;
  }
  next();
}

/** Redirect to /onboarding if auth'd but not yet onboarded. */
function requireOnboarded(req, res, next) {
  if (res.locals.user && !res.locals.user.is_onboarded) {
    return res.redirect('/onboarding');
  }
  next();
}

/** 403 if not admin. */
function requireAdmin(req, res, next) {
  if (!res.locals.user || !res.locals.user.is_admin) {
    return res.status(403).render('error', { pageTitle: '403', message: 'Forbidden' });
  }
  next();
}

/** 403 if not a floor speaker (or admin). */
function requireFloorSpeaker(req, res, next) {
  const user = res.locals.user;
  if (!user || (user.role !== 'floor_speaker' && !user.is_admin)) {
    return res.status(403).render('error', { pageTitle: '403', message: 'Forbidden' });
  }
  next();
}

/**
 * 403 if not admin AND not the floor speaker for req.params.floorId.
 * Must come after requireAuth + requireOnboarded.
 */
function requireFloorAccess(req, res, next) {
  const user = res.locals.user;
  const floorId = parseInt(req.params.floorId);
  if (user.is_admin) return next();
  if (user.role === 'floor_speaker' && parseInt(user.managed_floor_id) === floorId) return next();
  return res.status(403).render('error', { pageTitle: '403', message: 'Forbidden – not your floor' });
}

module.exports = { loadUser, requireAuth, requireOnboarded, requireAdmin, requireFloorSpeaker, requireFloorAccess, invalidateUserCache };
