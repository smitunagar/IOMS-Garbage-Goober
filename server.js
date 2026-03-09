require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const path = require('path');
const pgSession = require('connect-pg-simple')(session);

const { initDatabase, getPool } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const { i18nMiddleware } = require('./middleware/i18n');

const app = express();
const PORT = process.env.PORT || 3000;

// ── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));

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
