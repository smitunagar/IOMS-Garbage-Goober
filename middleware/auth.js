const { getDb } = require('../config/database');

/** Populate res.locals.user from session if logged in. */
function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.path = req.path;

  if (req.session && req.session.userId) {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      res.locals.user = user;
    } else {
      // stale session – clear it
      req.session.userId = null;
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

module.exports = { loadUser, requireAuth, requireOnboarded, requireAdmin };
