'use strict';
const express = require('express');
const multer  = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// ── Rule-based bin keyword database ──────────────────────────────────────────
const BIN_KEYWORDS = {
  biomuell: {
    strong: [
      'food waste', 'organic waste', 'fruit peel', 'vegetable scrap', 'food scrap',
      'banana peel', 'apple core', 'eggshell', 'egg shell', 'coffee grounds',
      'coffee filter', 'tea bag', 'food remains', 'kitchen waste',
    ],
    normal: [
      'banana', 'apple', 'orange', 'lemon', 'pear', 'grape', 'strawberry', 'kiwi',
      'mango', 'avocado', 'watermelon', 'peel', 'rind', 'core', 'pit', 'seed',
      'fruit', 'vegetable', 'salad', 'lettuce', 'carrot', 'potato', 'onion',
      'tomato', 'cucumber', 'pepper', 'corn', 'broccoli', 'spinach', 'celery',
      'asparagus', 'zucchini', 'mushroom', 'garlic', 'ginger', 'herb',
      'bread', 'pasta', 'rice', 'noodle', 'cereal', 'cooked food', 'leftover',
      'meat', 'fish', 'bone', 'chicken', 'sausage', 'egg', 'dairy', 'cheese',
      'coffee', 'tea', 'flower', 'grass', 'leaf', 'leaves', 'plant', 'soil',
      'organic', 'food', 'nut', 'walnut', 'almond', 'peach', 'plum',
    ],
  },
  papier: {
    strong: [
      'newspaper', 'cardboard box', 'paper bag', 'egg carton', 'cardboard',
      'pizza box', 'paper packaging', 'wrapping paper', 'paper board',
    ],
    normal: [
      'paper', 'book', 'magazine', 'catalog', 'brochure', 'flyer', 'envelope',
      'notebook', 'box', 'carton', 'receipt', 'tissue box', 'paper roll',
      'toilet roll', 'journal', 'document', 'folder', 'binder', 'postcard',
      'card', 'sheet', 'leaflet', 'pamphlet', 'newspaper', 'corrugated',
    ],
  },
  verpackung: {
    strong: [
      'plastic packaging', 'plastic bottle', 'plastic container', 'metal can',
      'aluminum can', 'tin can', 'yogurt container', 'drink carton',
      'tetra pak', 'blister pack', 'plastic film', 'plastic wrap',
      'shampoo bottle', 'detergent bottle', 'plastic tray',
    ],
    normal: [
      'plastic', 'bottle', 'container', 'packaging', 'wrapper', 'foil',
      'film', 'aluminum', 'aluminium', 'can', 'tin', 'shampoo', 'detergent',
      'tray', 'cup', 'lid', 'cap', 'tube', 'zip bag', 'cling film',
      'chip bag', 'crisp packet', 'snack wrapper', 'polystyrene', 'styrofoam',
      'yogurt', 'cream cheese', 'juice carton', 'milk carton', 'conditioner',
      'lotion', 'spray', 'dispenser', 'blister', 'sachets',
    ],
  },
  restmuell: {
    strong: [
      'used tissue', 'dirty tissue', 'wet wipe', 'diaper', 'nappy',
      'cigarette butt', 'vacuum bag', 'broken ceramic', 'contaminated',
    ],
    normal: [
      'ceramic', 'porcelain', 'diaper', 'cigarette', 'rubber', 'leather',
      'mirror', 'ash', 'dust', 'pen', 'pencil', 'ballpoint', 'marker',
      'crayon', 'bandage', 'medical', 'mask', 'glove', 'tape', 'sticker',
      'label', 'electronic', 'battery', 'textile', 'fabric', 'clothing',
      'cd', 'dvd', 'photograph', 'photo', 'styrofoam block', 'broken',
      'oil', 'paint', 'chemical', 'ink', 'cosmetic', 'makeup',
    ],
  },
};

// ── Bin display metadata ──────────────────────────────────────────────────────
const BIN_META = {
  biomuell: {
    label: 'BIOMUELL',
    sub_label: 'Brown Bin · Biomülltonne',
    icon: 'bi-tree-fill',
    color: '#2E7D32',
    explanation: 'Organic & food waste → brown bin (Biomülltonne).',
    steps: [
      { icon: 'bi-scissors',      text: '<strong>Remove packaging</strong> — take the item out of any plastic bag or wrapping first' },
      { icon: 'bi-droplet-half',  text: '<strong>Drain excess liquid</strong> — sauces are fine, but pour off standing water' },
      { icon: 'bi-check2-circle', text: '<strong>Drop it in</strong> the brown Biomüll bin' },
    ],
    tip: 'Use paper bags or certified compostable liners — regular plastic bags are not allowed in the Biomüll.',
  },
  papier: {
    label: 'PAPIER',
    sub_label: 'Blue Bin · Papiertonne',
    icon: 'bi-newspaper',
    color: '#1565C0',
    explanation: 'Paper & cardboard → blue bin (Papiertonne).',
    steps: [
      { icon: 'bi-x-circle',        text: '<strong>Remove plastic parts</strong> — plastic windows in envelopes, plastic handles on bags' },
      { icon: 'bi-arrows-collapse',  text: '<strong>Flatten boxes</strong> — break cardboard flat to save space in the bin' },
      { icon: 'bi-moisture',         text: '<strong>Keep it dry</strong> — wet or heavily soiled paper must go in Restmüll' },
      { icon: 'bi-check2-circle',    text: '<strong>Drop it in</strong> the blue Papier bin' },
    ],
    tip: 'Pizza boxes with heavy grease stains belong in Restmüll, not Papier.',
  },
  verpackung: {
    label: 'VERPACKUNG',
    sub_label: 'Yellow Bag · Gelber Sack',
    icon: 'bi-recycle',
    color: '#F9A825',
    explanation: 'Packaging materials (Grüner Punkt) → yellow bag/bin (Gelber Sack).',
    steps: [
      { icon: 'bi-cup-fill',         text: '<strong>Empty the container</strong> — rinse out food or drink residue (a quick rinse is enough)' },
      { icon: 'bi-arrows-collapse',  text: '<strong>Crush it flat</strong> — flatten bottles, tins, and plastic trays to save space' },
      { icon: 'bi-tag',              text: '<strong>Labels stay on</strong> — no need to remove stickers or printed labels' },
      { icon: 'bi-check2-circle',    text: '<strong>Drop it in</strong> the yellow Gelber Sack bag' },
    ],
    tip: 'Look for the green dot (Grüner Punkt ♻) symbol on the packaging — that confirms it belongs here.',
  },
  restmuell: {
    label: 'RESTMUELL',
    sub_label: 'Grey Bin · Restmülltonne',
    icon: 'bi-trash3-fill',
    color: '#616161',
    explanation: 'Non-recyclable waste → grey bin (Restmülltonne).',
    steps: [
      { icon: 'bi-search',        text: '<strong>Check for separable parts</strong> — remove batteries, metal screws, or any recyclable components first' },
      { icon: 'bi-slash-circle',  text: '<strong>Cannot be recycled</strong> — the remaining item has no other bin' },
      { icon: 'bi-check2-circle', text: '<strong>Drop it in</strong> the grey Restmüll bin' },
    ],
    tip: 'Hazardous items (batteries, paint, chemicals) must go to a special Wertstoffhof — never in any bin.',
  },
};

// ── Rule-based bin mapper ─────────────────────────────────────────────────────
function mapToBin(itemName, description, hints = []) {
  const text = [itemName, description, ...hints].join(' ').toLowerCase();

  const scores = { biomuell: 0, papier: 0, verpackung: 0, restmuell: 0 };

  for (const [bin, kw] of Object.entries(BIN_KEYWORDS)) {
    for (const k of kw.strong) { if (text.includes(k)) scores[bin] += 3; }
    for (const k of kw.normal) { if (text.includes(k)) scores[bin] += 1; }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topScore = sorted[0][1];

  // No keyword hit → default RESTMUELL with low confidence
  if (topScore === 0) {
    return { primary: 'restmuell', mappingConfidence: 0.25, fallbacks: [] };
  }

  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const mappingConfidence = topScore / total;
  const fallbacks = sorted.slice(1).filter(([, s]) => s > 0).map(([b]) => b);

  return { primary: sorted[0][0], mappingConfidence, fallbacks };
}

// ── POST /api/scan-waste ──────────────────────────────────────────────────────
router.post('/scan-waste', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No image provided.' });
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
    return res.status(503).json({ ok: false, error: 'AI scanner not configured. Please add your GEMINI_API_KEY in the environment settings.' });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const base64 = req.file.buffer.toString('base64');
  const mime   = req.file.mimetype || 'image/jpeg';

  const prompt =
    'You are a waste sorting assistant. ' +
    'Look at the image and identify ALL distinct waste items visible (e.g. food, tissue, packaging, etc.). ' +
    'Respond ONLY with valid JSON (no markdown, no extra text) in this exact format:\n' +
    '{"items":[{"item_name":"<concise English name>","description":"<one sentence about material/type>",' +
    '"material_hints":["<material1>","<material2>"]}]}\n' +
    'List each visually distinct waste item separately. Maximum 5 items. ' +
    'Be specific about materials (e.g. "plastic bottle", not just "bottle").';

  let aiResult;
  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: mime, data: base64 } },
    ]);
    const raw = result.response.text().trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in response: ' + raw.slice(0, 200));
    aiResult = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('AI scanner error:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not analyse the image. Please try again.' });
  }

  // Normalise — support both old single-item and new multi-item format
  let items = [];
  if (Array.isArray(aiResult.items)) {
    items = aiResult.items;
  } else if (aiResult.item_name) {
    items = [{ item_name: aiResult.item_name, description: aiResult.description || '', material_hints: aiResult.material_hints || [] }];
  }
  if (!items.length) {
    return res.status(500).json({ ok: false, error: 'Could not identify any waste items in the image.' });
  }

  const results = items.map(({ item_name = 'Unknown item', description = '', material_hints = [] }) => {
    const { primary } = mapToBin(item_name, description, material_hints);
    return {
      item_name,
      description,
      recommended_bin: primary,
      bin_meta: BIN_META[primary],
    };
  });

  res.json({ ok: true, items: results });
});

module.exports = router;
