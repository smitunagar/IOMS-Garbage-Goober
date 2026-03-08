const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const path = require('path');

const { initDatabase, SQLiteStore } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const { i18nMiddleware } = require('./middleware/i18n');

// ── Initialise ──────────────────────────────────────────────────────────────
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// ── View engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

// ── Body parsing ────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Sessions (SQLite-backed) ────────────────────────────────────────────────
const storeFactory = new SQLiteStore(session);
app.use(session({
  store: storeFactory.create(session),
  secret: process.env.SESSION_SECRET || 'ioms-individual-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Global middleware ───────────────────────────────────────────────────────
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

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/home', require('./routes/home'));
app.use('/disposal', require('./routes/disposal'));
app.use('/alerts', require('./routes/alerts'));
app.use('/history', require('./routes/history'));
app.use('/admin', require('./routes/admin'));

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

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🗑️  IOMS Individual running at http://localhost:${PORT}\n`);
});
