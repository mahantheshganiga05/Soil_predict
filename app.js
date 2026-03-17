/* ============================================================
   SoilSense – app.js  (Frontend)
   No API key needed from user — it's hidden on the server!
   ============================================================ */

// ── STATE ─────────────────────────────────────────────────────
let selectedFile = null;
let selectedCrop = '';

// ── DOM READY ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupManualToggle();
  setupCropButtons();
  setupPHSlider();
  setupAnalyzeButton();
  setupResetButton();
});

// ── FILE UPLOAD ───────────────────────────────────────────────
function setupUpload() {
  const zone      = document.getElementById('uploadZone');
  const input     = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const removeBtn = document.getElementById('removeBtn');
  const card      = document.getElementById('uploadCard');

  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => { if (e.target.files[0]) processFile(e.target.files[0]); });
  removeBtn.addEventListener('click', () => removeFile());

  card.addEventListener('dragover',  (e) => { e.preventDefault(); card.classList.add('dragover'); });
  card.addEventListener('dragleave', ()  => card.classList.remove('dragover'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('dragover');
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  });
}

function processFile(file) {
  const allowed = ['image/jpeg','image/png','image/jpg','image/webp','application/pdf'];
  if (!allowed.includes(file.type)) { showError('Please upload a JPG, PNG, or PDF file.'); return; }
  if (file.size > 10 * 1024 * 1024) { showError('File too large. Maximum 10 MB.'); return; }

  selectedFile = file;
  showError('');
  document.getElementById('previewName').textContent = file.name;
  document.getElementById('previewSize').textContent = (file.size / 1024).toFixed(1) + ' KB';

  const thumb = document.getElementById('previewThumb');
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => { thumb.innerHTML = `<img src="${e.target.result}" alt="preview">`; };
    reader.readAsDataURL(file);
  } else {
    thumb.innerHTML = '📄';
  }
  document.getElementById('filePreview').classList.add('show');
}

function removeFile() {
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('previewThumb').innerHTML = '📄';
}

// ── MANUAL TOGGLE ─────────────────────────────────────────────
function setupManualToggle() {
  document.getElementById('manualHeader').addEventListener('click', () => {
    document.getElementById('manualBody').classList.toggle('open');
    document.getElementById('manualChevron').classList.toggle('open');
  });
}

// ── CROP BUTTONS ──────────────────────────────────────────────
function setupCropButtons() {
  document.getElementById('cropGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.crop-btn');
    if (!btn) return;
    document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCrop = btn.dataset.crop;
  });
}

// ── PH SLIDER ─────────────────────────────────────────────────
function setupPHSlider() {
  document.getElementById('ph').addEventListener('input', (e) => {
    document.getElementById('phDisplay').textContent = parseFloat(e.target.value).toFixed(1);
  });
}

// ── ANALYZE ───────────────────────────────────────────────────
function setupAnalyzeButton() {
  document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const formData = collectFormData();

    if (!selectedFile && !formData.hasManualData) {
      showError('⚠️ Please upload a soil test report OR enter at least one soil value manually.');
      return;
    }

    showError('');
    startAnalyzing();

    try {
      const payload = new FormData();
      payload.append('formData', JSON.stringify(formData));
      if (selectedFile) payload.append('soilReport', selectedFile);

      // No API key sent — it's stored safely on the server!
      const response = await fetch('/api/analyze', { method: 'POST', body: payload });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      setTimeout(() => {
        stopAnalyzing();
        renderResults(result);
      }, 3000);

    } catch (err) {
      console.error(err);
      stopAnalyzing();
      showError(`❌ ${err.message || 'Analysis failed. Please try again.'}`);
      document.getElementById('analyzeBtn').disabled = false;
    }
  });
}

function collectFormData() {
  const N    = parseFloat(document.getElementById('nitrogen').value);
  const P    = parseFloat(document.getElementById('phosphorus').value);
  const K    = parseFloat(document.getElementById('potassium').value);
  const mois = parseFloat(document.getElementById('moisture').value);
  const temp = parseFloat(document.getElementById('temperature').value);
  const ph   = parseFloat(document.getElementById('ph').value);
  return {
    N: isNaN(N) ? null : N, P: isNaN(P) ? null : P, K: isNaN(K) ? null : K,
    moisture: isNaN(mois) ? null : mois, temperature: isNaN(temp) ? null : temp,
    ph, crop: selectedCrop,
    hasManualData: !isNaN(N) || !isNaN(P) || !isNaN(K),
  };
}

// ── RESET ─────────────────────────────────────────────────────
function setupResetButton() {
  document.getElementById('resetBtn').addEventListener('click', () => {
    removeFile();
    ['nitrogen','phosphorus','potassium','moisture','temperature'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('ph').value = 6.5;
    document.getElementById('phDisplay').textContent = '6.5';
    document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('selected'));
    selectedCrop = '';
    document.getElementById('result').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = false;
    showError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── ANALYZING UI ──────────────────────────────────────────────
function startAnalyzing() {
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('analyzingCard').classList.add('show');
  document.getElementById('result').style.display = 'none';
  document.querySelectorAll('.anim-step').forEach((s, i) => {
    setTimeout(() => s.classList.add('done'), (i + 1) * 700);
  });
}

function stopAnalyzing() {
  document.getElementById('analyzingCard').classList.remove('show');
  document.querySelectorAll('.anim-step').forEach(s => s.classList.remove('done'));
}

// ── RENDER RESULTS ────────────────────────────────────────────
function renderResults(data) {
  // Farmer info card
  if (data.farmer_name || data.location) {
    document.getElementById('farmerCard').style.display = 'flex';
    document.getElementById('farmerName').textContent     = data.farmer_name || '';
    document.getElementById('farmerLocation').textContent = data.location    || '';
    document.getElementById('farmerSample').textContent   = data.sample_id ? `Sample: ${data.sample_id}` : '';
  }

  // Verdict
  const map = { Poor:{cls:'poor',emoji:'🔴'}, Moderate:{cls:'moderate',emoji:'⚠️'}, Good:{cls:'good',emoji:'✅'}, Excellent:{cls:'excellent',emoji:'🌟'} };
  const r   = map[data.fertility_rating] || map['Moderate'];
  document.getElementById('verdictCard').className       = `verdict-card ${r.cls}`;
  document.getElementById('verdictEmoji').textContent    = r.emoji;
  document.getElementById('verdictRating').textContent   = `${data.fertility_rating} Fertility`;
  document.getElementById('verdictScore').textContent    = `Overall Score: ${data.score}/100`;
  document.getElementById('verdictDesc').textContent     = data.summary;

  // Nutrient bars
  const color = s => s==='Optimal'?'#6fcf5a': s==='Low'||s==='Acidic'?'#e05656':'#e8b84b';
  const sc    = (v,lo,hi) => { if(!v||isNaN(v)) return 50; if(v<lo) return Math.max(10,(v/lo)*75); if(v>hi) return Math.max(20,100-((v-hi)/hi)*40); return 80+((v-lo)/(hi-lo))*20; };
  const ns    = data.nutrient_status || {};
  const ex    = data.extracted       || {};

  const nutrients = [
    { icon:'🌿', name:'Nitrogen (N)',   val: ex.N        ? `${ex.N} kg/ha`  : 'N/A', status: ns.N        || '—', pct: sc(ex.N, 80, 200) },
    { icon:'🌸', name:'Phosphorus (P)', val: ex.P        ? `${ex.P} kg/ha`  : 'N/A', status: ns.P        || '—', pct: sc(ex.P, 20, 80)  },
    { icon:'🍂', name:'Potassium (K)',  val: ex.K        ? `${ex.K} kg/ha`  : 'N/A', status: ns.K        || '—', pct: sc(ex.K, 100, 350)},
    { icon:'⚗️', name:'Soil pH',        val: ex.pH       ? `${ex.pH}`       : 'N/A', status: ns.pH       || '—', pct: sc(ex.pH, 5.5, 7.0)},
    { icon:'💧', name:'Moisture',       val: ex.moisture ? `${ex.moisture}%`: 'N/A', status: ns.moisture || '—', pct: sc(ex.moisture, 20, 60)},
  ];

  document.getElementById('nutrientBars').innerHTML = nutrients.map(n => `
    <div class="nutrient-row">
      <div class="nutrient-icon">${n.icon}</div>
      <div class="nutrient-meta">
        <div class="nutrient-label">${n.name}
          <span>${n.val} · <strong style="color:${color(n.status)}">${n.status}</strong></span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="background:${color(n.status)}" data-w="${Math.round(n.pct)}%"></div>
        </div>
      </div>
    </div>`).join('');

  setTimeout(() => {
    document.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.w; });
  }, 120);

  // Crops
  document.getElementById('cropRecs').innerHTML = (data.crop_recommendations || []).map(c => `
    <div class="crop-rec-item">
      <div class="rec-icon">${c.emoji}</div>
      <div class="rec-name">${c.name}</div>
      <span class="suitability-badge suit-${(c.suitability||'medium').toLowerCase()}">${c.suitability} Match</span>
      <div class="rec-reason">${c.reason}</div>
    </div>`).join('');

  // AI advice
  document.getElementById('aiText').textContent = data.detailed_advice || '';

  // Show
  document.getElementById('result').style.display = 'block';
  document.getElementById('analyzeBtn').disabled  = false;
  setTimeout(() => document.getElementById('result').scrollIntoView({ behavior:'smooth', block:'start' }), 100);
}

// ── HELPERS ───────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}