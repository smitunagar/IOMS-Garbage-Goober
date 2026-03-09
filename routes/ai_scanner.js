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
    emoji: '🌿',
    color: '#2E7D32',
    explanation: 'Organic & food waste → brown bin (Biomülltonne).',
  },
  papier: {
    label: 'PAPIER',
    emoji: '📦',
    color: '#1565C0',
    explanation: 'Paper & cardboard → blue bin (Papiertonne).',
  },
  verpackung: {
    label: 'VERPACKUNG',
    emoji: '♻️',
    color: '#E65100',
    explanation: 'Packaging materials (Grüner Punkt) → yellow bag/bin (Gelber Sack).',
  },
  restmuell: {
    label: 'RESTMUELL',
    emoji: '🗑️',
    color: '#616161',
    explanation: 'Non-recyclable waste → grey bin (Restmülltonne).',
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
    'You are a waste item identification assistant. ' +
    'Given this image of a waste item, identify it and respond ONLY with valid JSON ' +
    '(no markdown, no extra text) in this exact format:\n' +
    '{"item_name":"<concise name in English>","description":"<one sentence about material/type>",' +
    '"material_hints":["<material1>","<material2>"]}\n' +
    'Focus on the primary waste item. Be specific about materials (e.g. "plastic bottle", not just "bottle").';

  let aiResult;
  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: mime, data: base64 } },
    ]);
    const raw = result.response.text().trim();
    // Extract JSON object from anywhere in the response (handles markdown fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in response: ' + raw.slice(0, 200));
    aiResult = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('AI scanner error:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not analyse the image. Please try again.' });
  }

  const {
    item_name      = 'Unknown item',
    description    = '',
    material_hints = [],
  } = aiResult;

  const { primary } = mapToBin(item_name, description, material_hints);

  res.json({
    ok: true,
    item_name,
    description,
    recommended_bin: primary,
    bin_meta:        BIN_META[primary],
  });
});

module.exports = router;
