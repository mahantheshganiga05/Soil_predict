/* ============================================================
   SoilSense – server.js  (Backend)
   API key is stored ONLY on the server in .env file
   Farmers never see or need to enter any API key!
   ============================================================ */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── LOAD API KEY FROM .env FILE ──────────────────────────────
// Tries to load .env file if it exists (for local development)
try {
  const fs   = require('fs');
  const env  = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch (e) {
  // .env not found — that's fine on Railway (uses dashboard env vars)
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

if (!GEMINI_API_KEY) {
  console.warn('⚠️  WARNING: GEMINI_API_KEY not set. Add it to .env file or Railway dashboard.');
}

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── FILE UPLOAD (in memory, max 10MB) ────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Use JPG, PNG or PDF only.'));
  },
});

// ── GEMINI API CALL ───────────────────────────────────────────
function callGemini(parts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path:     `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Gemini API error'));
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse Gemini response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── ANALYSIS PROMPT ───────────────────────────────────────────
function buildPrompt(formData) {
  const lines = [];
  if (formData.N    !== null) lines.push(`Nitrogen (N): ${formData.N} kg/ha`);
  if (formData.P    !== null) lines.push(`Phosphorus (P): ${formData.P} kg/ha`);
  if (formData.K    !== null) lines.push(`Potassium (K): ${formData.K} kg/ha`);
  if (formData.moisture    !== null) lines.push(`Moisture: ${formData.moisture}%`);
  if (formData.temperature !== null) lines.push(`Temperature: ${formData.temperature}°C`);
  if (formData.ph)  lines.push(`pH: ${formData.ph}`);
  if (formData.crop) lines.push(`Target crop: ${formData.crop}`);

  return `You are SoilSense, an expert agricultural AI helping farmers.
Analyze the soil data from the uploaded document (if present) or manual values below.
Extract all soil parameters visible in the image/document.
Respond ONLY with valid JSON — no markdown, no backticks, no extra text.

Return exactly this JSON:
{
  "farmer_name": "<name from report or null>",
  "location": "<location from report or null>",
  "sample_id": "<sample ID or null>",
  "fertility_rating": "Poor" | "Moderate" | "Good" | "Excellent",
  "score": <integer 0-100>,
  "summary": "<2 plain sentences a farmer can understand>",
  "extracted": {
    "N": <number or null>,
    "P": <number or null>,
    "K": <number or null>,
    "pH": <number or null>,
    "moisture": <number or null>,
    "temperature": <number or null>
  },
  "nutrient_status": {
    "N": "Low" | "Optimal" | "High",
    "P": "Low" | "Optimal" | "High",
    "K": "Low" | "Optimal" | "High",
    "pH": "Acidic" | "Optimal" | "Alkaline",
    "moisture": "Low" | "Optimal" | "High"
  },
  "crop_recommendations": [
    { "name": "<crop>", "emoji": "<emoji>", "suitability": "High"|"Medium"|"Low", "reason": "<one sentence>" },
    { "name": "<crop>", "emoji": "<emoji>", "suitability": "High"|"Medium"|"Low", "reason": "<one sentence>" },
    { "name": "<crop>", "emoji": "<emoji>", "suitability": "High"|"Medium"|"Low", "reason": "<one sentence>" },
    { "name": "<crop>", "emoji": "<emoji>", "suitability": "High"|"Medium"|"Low", "reason": "<one sentence>" }
  ],
  "detailed_advice": "<4-5 practical sentences in simple farmer-friendly language>"
}

${lines.length ? 'Manual values:\n' + lines.join('\n') : ''}`;
}

// ── FALLBACK (when Gemini fails) ──────────────────────────────
function generateFallback(formData) {
  const sc = (v, lo, hi) => {
    if (v === null || isNaN(v)) return 50;
    if (v < lo) return Math.max(10, (v / lo) * 75);
    if (v > hi) return Math.max(20, 100 - ((v - hi) / hi) * 40);
    return 80 + ((v - lo) / (hi - lo)) * 20;
  };
  const nS = sc(formData.N, 80, 200), pS = sc(formData.P, 20, 80);
  const kS = sc(formData.K, 100, 350), phS = sc(formData.ph, 5.5, 7.0);
  const mS = sc(formData.moisture, 20, 60);
  const overall = Math.round(nS*0.25 + pS*0.2 + kS*0.2 + phS*0.2 + mS*0.15);
  const rating  = overall >= 80 ? 'Excellent' : overall >= 60 ? 'Good' : overall >= 40 ? 'Moderate' : 'Poor';

  return {
    farmer_name: null, location: null, sample_id: null,
    fertility_rating: rating, score: overall,
    summary: `Your soil scores ${overall}/100 — rated ${rating}. ${overall >= 60 ? 'Good conditions for farming!' : 'Some improvements needed for better yields.'}`,
    extracted: { N: formData.N, P: formData.P, K: formData.K, pH: formData.ph, moisture: formData.moisture, temperature: formData.temperature },
    nutrient_status: {
      N: nS < 50 ? 'Low' : nS > 85 ? 'High' : 'Optimal',
      P: pS < 50 ? 'Low' : pS > 85 ? 'High' : 'Optimal',
      K: kS < 50 ? 'Low' : kS > 85 ? 'High' : 'Optimal',
      pH: phS < 50 ? (formData.ph < 5.5 ? 'Acidic' : 'Alkaline') : 'Optimal',
      moisture: mS < 50 ? 'Low' : mS > 85 ? 'High' : 'Optimal',
    },
    crop_recommendations: overall >= 65
      ? [
          { name:'Rice',       emoji:'🌾', suitability:'High',   reason:'Good NPK balance supports strong paddy yield.' },
          { name:'Wheat',      emoji:'🌿', suitability:'High',   reason:'Nutrient levels well-suited for wheat.' },
          { name:'Maize',      emoji:'🌽', suitability:'Medium', reason:'Performs well with adequate potassium.' },
          { name:'Vegetables', emoji:'🥬', suitability:'Medium', reason:'Fertile soil supports leafy crops.' },
        ]
      : [
          { name:'Pulses',       emoji:'🫘', suitability:'High', reason:'Fix nitrogen and earn income simultaneously.' },
          { name:'Groundnut',    emoji:'🥜', suitability:'High', reason:'Tolerates lower fertility very well.' },
          { name:'Green Manure', emoji:'🌱', suitability:'High', reason:'Enrich soil before next main crop.' },
          { name:'Sorghum',      emoji:'🌾', suitability:'Medium', reason:'Drought-tolerant for this soil type.' },
        ],
    detailed_advice: `Focus on ${nS < 50 ? 'adding nitrogen via urea or organic manure' : 'maintaining your current nutrient levels'}. ${phS < 50 ? (formData.ph < 5.5 ? 'Soil is too acidic — apply agricultural lime at 1-2 tonnes/acre.' : 'Soil is too alkaline — apply gypsum to lower pH.') : 'pH is in good range for most crops.'} ${mS < 50 ? 'Improve irrigation to keep moisture at 30–50%.' : 'Moisture is adequate — keep up regular watering.'} Practice crop rotation every season to maintain soil health. Re-test soil every 6 months to track improvement.`,
  };
}

// ── API ROUTE: POST /api/analyze ──────────────────────────────
app.post('/api/analyze', upload.single('soilReport'), async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured on server. Please add GEMINI_API_KEY to .env file.' });
    }

    const formData = JSON.parse(req.body.formData || '{}');
    const file     = req.file;

    // Build Gemini parts
    const parts = [];
    if (file) {
      parts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } });
    }
    parts.push({ text: buildPrompt(formData) });

    // Call Gemini
    let result;
    try {
      const rawText = await callGemini(parts);
      const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (err) {
      console.error('Gemini/parse error:', err.message);
      result = generateFallback(formData);
    }

    return res.json(result);

  } catch (err) {
    console.error('Server error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── SERVE FRONTEND ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  🌱 SoilSense is running!');
  console.log(`  👉 Open: http://localhost:${PORT}`);
  console.log('');
  console.log(GEMINI_API_KEY
    ? '  ✅ Gemini API key loaded successfully!'
    : '  ❌ No API key found — add GEMINI_API_KEY to .env file'
  );
  console.log('');
});