const { getDb } = require('../config/database');

/** Populate res.locals.user from session if logged in. */
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.path = req.path;

  if (req.session && req.session.userId) {
    try {
      const user = await getDb().queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      if (user) {
        res.locals.user = user;
      } else {
        req.session.userId = null;
      }
    } catch (err) {
      console.error('loadUser error:', err);
    }
  }
  next();
}

/** Redirect to /login if not authenticated. */
function requireAuth(req, res, next) {
  if (!res.locals.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
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

module.exports = { loadUser, requireAuth, requireOnboarded, requireAdmin, requireFloorSpeaker, requireFloorAccess };
