/* ── AI Waste Scanner client ─────────────────────────────────────────────────
   Handles FAB tap → camera → upload → result display
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const fab       = document.getElementById('waste-scan-fab');
  const fileInput = document.getElementById('waste-scan-input');
  const modal     = document.getElementById('waste-scan-modal');
  const overlay   = document.getElementById('waste-scan-overlay');
  const closeBtn  = document.getElementById('waste-scan-close');
  const scanAgain = document.getElementById('wsc-scan-again');
  const retryBtn  = document.getElementById('wsc-retry-btn');

  if (!fab || !modal) return; // Not on an authenticated page

  // ── Open camera ─────────────────────────────────────────────────────────
  fab.addEventListener('click', () => fileInput.click());
  if (scanAgain) scanAgain.addEventListener('click', () => fileInput.click());
  if (retryBtn)  retryBtn.addEventListener('click',  () => fileInput.click());

  // ── Close modal ──────────────────────────────────────────────────────────
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function closeModal() {
    modal.classList.remove('active');
    overlay.classList.remove('active');
    fileInput.value = '';
  }

  // ── Image selected ───────────────────────────────────────────────────────
  fileInput.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('wsc-preview-img').src = e.target.result;
      document.getElementById('wsc-preview-section').style.display = 'block';
      document.getElementById('wsc-scan-anim').style.display = 'block';
    };
    reader.readAsDataURL(file);

    setView('scanning');
    modal.classList.add('active');
    overlay.classList.add('active');

    // Upload to server
    const formData = new FormData();
    formData.append('image', file);

    fetch('/api/scan-waste', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        document.getElementById('wsc-scan-anim').style.display = 'none';
        if (data.ok) {
          renderResult(data);
          setView('result');
        } else {
          showError(data.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(() => {
        document.getElementById('wsc-scan-anim').style.display = 'none';
        showError('Network error. Please check your connection and try again.');
      });
  });

  // ── Render result ────────────────────────────────────────────────────────
  function renderResult(data) {
    // Bin badge
    const badge = document.getElementById('wsc-bin-badge');
    badge.textContent  = data.bin_meta.emoji + ' ' + data.bin_meta.label;
    badge.style.background = data.bin_meta.color;

    // Item details
    document.getElementById('wsc-item-name').textContent    = capitalise(data.item_name);
    document.getElementById('wsc-description').textContent  = data.description;
    document.getElementById('wsc-bin-explanation').textContent = data.bin_meta.explanation;

    // Confidence bar
    const pct  = data.confidence;
    const fill = document.getElementById('wsc-confidence-fill');
    fill.style.width      = pct + '%';
    fill.style.background = pct >= 70 ? '#2E7D32' : pct >= 50 ? '#F9A825' : '#D32F2F';
    document.getElementById('wsc-confidence-label').textContent = pct + '%';

    // Low-confidence warning
    document.getElementById('wsc-warning').style.display = data.low_confidence ? 'flex' : 'none';

    // Fallback chips
    const fbContainer = document.getElementById('wsc-fallbacks');
    fbContainer.innerHTML = '';
    if (data.fallbacks && data.fallbacks.length > 0) {
      data.fallbacks.forEach(fb => {
        const chip = document.createElement('span');
        chip.className         = 'wsc-fallback-chip';
        chip.style.background  = fb.color;
        chip.textContent       = fb.emoji + ' ' + fb.label;
        fbContainer.appendChild(chip);
      });
    }
  }

  // ── Error ────────────────────────────────────────────────────────────────
  function showError(msg) {
    document.getElementById('wsc-error-msg').textContent = msg;
    setView('error');
  }

  // ── View switcher ────────────────────────────────────────────────────────
  function setView(view) {
    ['scanning', 'result', 'error'].forEach(v => {
      const el = document.getElementById('wsc-view-' + v);
      if (el) el.style.display = (v === view) ? 'block' : 'none';
    });
  }

  // ── Utility ──────────────────────────────────────────────────────────────
  function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }
})();
