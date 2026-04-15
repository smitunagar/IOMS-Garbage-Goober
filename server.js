require('dotenv').config();
const express = require('express');
const compression = require('compression');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const path = require('path');
const pgSession = require('connect-pg-simple')(session);

const { initDatabase, getPool } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const { i18nMiddleware } = require('./middleware/i18n');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Gzip compression ─────────────────────────────────────────────────────────
app.use(compression());

// ── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));

// ── Service Worker: inject DEPLOY_ID so cache auto-busts on every deploy ────
// Vercel sets VERCEL_GIT_COMMIT_SHA on every deploy; falls back to startup time.
const fs = require('fs');
const SW_DEPLOY_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);
const _swSource = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
const _swContent = _swSource.replace('__DEPLOY_ID__', SW_DEPLOY_ID);
app.get('/sw.js', (_req, res) => {
  // no-store so the browser always re-fetches and notices a new SW version
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(_swContent);
});

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Sessions (PostgreSQL-backed via Neon) ────────────────────────────────────
app.use(session({
  store: new pgSession({
    pool: getPool(),
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'ioms-individual-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Lazy DB init (ensures schema exists before first request) ─────────────────
let dbInitialized = false;
const dbReadyPromise = initDatabase().then(() => { dbInitialized = true; }).catch(err => {
  console.error('DB init failed:', err);
});
app.use(async (req, res, next) => {
  if (dbInitialized) return next();
  try {
    await dbReadyPromise;
    next();
  } catch (err) {
    res.status(500).send('Database initialisation failed.');
  }
});

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(loadUser);
app.use(i18nMiddleware);

// Flash messages via session
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  res.locals.path = req.path;
  next();
});

// Make constants available in templates
const constants = require('./utils/constants');
const rotation = require('./utils/rotation');
app.use((req, res, next) => {
  res.locals.C = constants;
  res.locals.R = rotation;
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/home', require('./routes/home'));
app.use('/disposal', require('./routes/disposal'));
app.use('/alerts', require('./routes/alerts'));
app.use('/history', require('./routes/history'));
app.use('/admin', require('./routes/admin'));
app.use('/floor-speaker', require('./routes/floor_speaker'));
app.use('/api', require('./routes/ai_scanner'));
app.use('/holidays', require('./routes/holidays'));
app.use('/push', require('./routes/push'));
app.use('/profile', require('./routes/profile'));

// PWA offline page
app.get('/offline', (req, res) => {
  res.render('offline', { pageTitle: 'Offline', layout: false });
});

// Digital Asset Links for TWA (Play Store)
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json(require('./config/assetlinks.json'));
});

// Apple App Site Association for Universal Links (iOS)
const aasa = require('./config/apple-app-site-association.json');
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(aasa);
});
app.get('/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(aasa);
});

// Root redirect
app.get('/', (req, res) => {
  if (res.locals.user) {
    return res.redirect(res.locals.user.is_onboarded ? '/home' : '/onboarding');
  }
  res.redirect('/login');
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { pageTitle: '404', message: 'Page not found.' });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', { pageTitle: '500', message: 'Something went wrong. Please try again.' });
});

// ── Export for Vercel / Start locally ────────────────────────────────────────
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🗑️  IOMS Individual running at http://localhost:${PORT}\n`);
  });
}
