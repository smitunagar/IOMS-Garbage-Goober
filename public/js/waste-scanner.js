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
    // Support both old single-item and new multi-item format
    const items = data.items || [{ item_name: data.item_name, description: data.description, bin_meta: data.bin_meta }];

    const cardsHtml = items.map(item => {
      const m = item.bin_meta;
      const textColor = m.color === '#F9A825' ? '#5a3e00' : '#fff';
      const subColor  = m.color === '#F9A825' ? 'rgba(90,62,0,0.75)' : 'rgba(255,255,255,0.80)';

      const stepsHtml = (m.steps || []).map((s, i) => `
        <div class="wsc-step">
          <div class="wsc-step-num" style="background:${m.color};color:${textColor}">${i + 1}</div>
          <div class="wsc-step-body">
            <i class="bi ${s.icon}" style="color:${m.color}"></i>
            <span>${s.text}</span>
          </div>
        </div>`).join('');

      const tipHtml = m.tip ? `
        <div class="wsc-tip" style="border-left:3px solid ${m.color};background:${m.color}12">
          <i class="bi bi-lightbulb-fill" style="color:${m.color}"></i>
          <span>${m.tip}</span>
        </div>` : '';

      return `
        <div class="wsc-item-card" style="border-top:3px solid ${m.color};margin-bottom:1.25rem;padding-bottom:0.5rem">
          <div class="wsc-bin-hero" style="background:${m.color}">
            <i class="bi ${m.icon} wsc-bin-hero-icon" style="color:${textColor}"></i>
            <div class="wsc-bin-hero-text">
              <div class="wsc-bin-hero-name" style="color:${textColor}">${m.label}</div>
              <div class="wsc-bin-hero-sub" style="color:${subColor}">${m.sub_label}</div>
            </div>
          </div>
          <div class="wsc-detected-item">
            <div class="wsc-detected-label">Detected item</div>
            <div class="wsc-detected-name">${capitalise(item.item_name)}</div>
            <div class="wsc-detected-desc">${item.description}</div>
          </div>
          <div class="wsc-steps-wrap">
            <div class="wsc-steps-title">
              <i class="bi bi-list-check" style="color:${m.color}"></i> How to dispose
            </div>
            ${stepsHtml}
          </div>
          ${tipHtml}
        </div>`;
    }).join('');

    const multiNote = items.length > 1
      ? `<div class="wsc-multi-note"><i class="bi bi-layers me-1"></i>${items.length} items detected in this photo</div>`
      : '';

    document.getElementById('wsc-result-content').innerHTML = multiNote + cardsHtml;
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
