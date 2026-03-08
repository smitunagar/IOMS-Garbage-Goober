const de = require('../locales/de.json');
const en = require('../locales/en.json');

const translations = { de, en };

/**
 * Makes `t(key, params)` and `lang` available in all templates.
 * Language priority: query ?lang=xx  →  session  →  user DB preference  →  'de'
 */
function i18nMiddleware(req, res, next) {
  // Allow switching via query param
  if (req.query.lang && translations[req.query.lang]) {
    req.session.language = req.query.lang;
  }

  const lang = req.session?.language
    || (res.locals.user && res.locals.user.language)
    || 'de';

  const strings = translations[lang] || translations.de;

  res.locals.lang = lang;
  res.locals.t = (key, params = {}) => {
    let str = strings[key] || key;
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
    return str;
  };

  next();
}

module.exports = { i18nMiddleware };
