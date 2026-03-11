/* ── IOMS Individual – Client JS ─────────────────────────────────────────── */

// Auto-dismiss alerts after 4 seconds
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert-dismissible[data-auto-dismiss]').forEach(el => {
    setTimeout(() => {
      const bs = bootstrap.Alert.getOrCreateInstance(el);
      bs.close();
    }, 4000);
  });
});

/* ── Bin-type chip toggle ────────────────────────────────────────────────── */
function toggleBinChip(el) {
  const cb = el.querySelector('input');
  if (cb) {
    if (cb.type === 'checkbox') {
      cb.checked = !cb.checked;
    }
    el.classList.toggle('selected', cb.checked);
  }  updatePhotoSlots();}

/* ── Dynamic photo slots (one per selected bin) ────────────────────────── */
const _slotData = {}; // { binKey: 'data:image/jpeg;base64,...' }

function updatePhotoSlots() {
  const wrapper   = document.getElementById('photo-slots-wrapper');
  const container = document.getElementById('photo-slots');
  if (!wrapper || !container) return;

  const checkedBins = Array.from(document.querySelectorAll('input[name="bins"]:checked'));

  if (checkedBins.length === 0) {
    wrapper.style.display = 'none';
    container.innerHTML = '';
    _updateSubmitState();
    return;
  }

  wrapper.style.display = 'block';

  const existing = {};
  container.querySelectorAll('.photo-slot').forEach(s => { existing[s.dataset.bin] = s; });

  // Remove slots for unchecked bins
  Object.keys(existing).forEach(bin => {
    if (!checkedBins.find(cb => cb.value === bin)) {
      existing[bin].remove();
      delete existing[bin];
      delete _slotData[bin];
    }
  });

  // Add slots for newly checked bins
  checkedBins.forEach(cb => {
    const bin   = cb.value;
    const card  = cb.closest('label');
    const emoji = card.querySelector('.bin-select-swatch').textContent.trim();
    const name  = card.querySelector('.bin-select-info strong').textContent.trim();
    if (!existing[bin]) {
      const slot = document.createElement('div');
      slot.className = 'photo-slot';
      slot.dataset.bin = bin;
      slot.innerHTML = `
        <div class="photo-slot-label">
          <span style="font-size:1.2rem">${emoji}</span>
          <strong>${name}</strong>
          <span class="badge bg-danger ms-1" style="font-size:0.65rem">Required</span>
        </div>
        <input type="file" accept="image/*" capture="environment"
               onchange="_previewSlot(this,'${bin}')">
        <div id="slot-preview-${bin}" style="display:none" class="mt-2">
          <img src="" alt="" style="max-height:150px;border-radius:8px;border:1px solid #dee2e6">
        </div>`;
      container.appendChild(slot);
    }
  });

  checkedBins.forEach(cb => container.appendChild(container.querySelector(`[data-bin="${cb.value}"]`)));
  _updateSubmitState();
}

function _previewSlot(input, bin) {
  if (!input.files || !input.files[0]) {
    delete _slotData[bin];
    const div = document.getElementById('slot-preview-' + bin);
    if (div) div.style.display = 'none';
    _updateSubmitState();
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUri = canvas.toDataURL('image/jpeg', 0.75);
      _slotData[bin] = dataUri;
      const div = document.getElementById('slot-preview-' + bin);
      if (div) { div.querySelector('img').src = dataUri; div.style.display = 'block'; }
      _updateSubmitState();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}

function _updateSubmitState() {
  const btn    = document.getElementById('disposal-submit-btn');
  if (!btn) return;
  const needed = document.querySelectorAll('input[name="bins"]:checked').length;
  const filled = Object.keys(_slotData).length;
  const ready  = needed > 0 && filled >= needed;
  btn.disabled = !ready;
  btn.innerHTML = (needed > 0 && filled < needed)
    ? `<i class="bi bi-camera me-1"></i>Add photos (${filled}/${needed})`
    : `<i class="bi bi-check-circle me-1"></i>Send`;
}

/* ── Disposal form – JSON submit with compressed photos ─────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('disposal-form');
  if (!form) return;

  const btn = document.getElementById('disposal-submit-btn');
  if (btn) btn.disabled = true;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const bins   = Array.from(form.querySelectorAll('input[name="bins"]:checked')).map(i => i.value);
    const note   = (form.querySelector('textarea[name="note"]') || {}).value || '';
    const photos = bins.map(b => _slotData[b]).filter(Boolean);
    const errEl  = document.getElementById('disposal-error');

    if (errEl) errEl.classList.add('d-none');

    if (!bins.length) {
      if (errEl) { errEl.textContent = 'Please select at least one bin.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (photos.length < bins.length) {
      if (errEl) { errEl.textContent = `Please add a photo for all ${bins.length} bins.`; errEl.classList.remove('d-none'); }
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Saving…'; }

    try {
      const res  = await fetch('/disposal/log', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bins, note, photos }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = '/home';
      } else {
        if (errEl) { errEl.textContent = data.error || 'Something went wrong.'; errEl.classList.remove('d-none'); }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Send'; }
      }
    } catch (_) {
      if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.classList.remove('d-none'); }
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Send'; }
    }
  });
});



/* ── Room selection (onboarding) ─────────────────────────────────────────── */
function selectRoom(roomId) {
  document.querySelectorAll('.room-cell').forEach(c => c.classList.remove('selected'));
  const cell = document.querySelector(`[data-room="${roomId}"]`);
  if (cell) cell.classList.add('selected');
  const input = document.getElementById('selectedRoom');
  if (input) input.value = roomId;
  const btn = document.getElementById('confirmBtn');
  if (btn) {
    btn.disabled = false;
    const label = cell ? cell.textContent.trim() : String(roomId);
    btn.textContent = btn.dataset.confirmText.replace('{room}', label);
  }
}

/* ── Floor selection (onboarding) ────────────────────────────────────────── */
function selectFloor(floorId) {
  document.querySelectorAll('.floor-chip').forEach(c => c.classList.remove('active'));
  const chip = document.querySelector(`[data-floor="${floorId}"]`);
  if (chip) chip.classList.add('active');
  document.getElementById('selectedFloor').value = floorId;

  // Show rooms for this floor (X09 and X11 are merged into X08/X09 and X10/X11)
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = '';
  for (let i = 1; i <= 18; i++) {
    if (i === 9 || i === 11) continue; // merged – not shown separately
    const roomId = floorId * 100 + i;
    const label = (i === 8 || i === 10) ? `${roomId}/${roomId + 1}` : String(roomId);
    const cell = document.createElement('div');
    cell.className = 'room-cell';
    cell.dataset.room = roomId;
    cell.textContent = label;
    cell.onclick = () => selectRoom(roomId);
    grid.appendChild(cell);
  }

  // Reset room selection
  document.getElementById('selectedRoom').value = '';
  const btn = document.getElementById('confirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = btn.dataset.selectText;
  }
}

/* ── Admin: room toggle ──────────────────────────────────────────────────── */
function toggleRoomActive(roomNum, floorId) {
  fetch(`/admin/rotation/${floorId}/toggle-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomNumber: roomNum }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) location.reload();
  });
}

function toggleRoomActiveFS(roomNum, floorId) {
  fetch(`/floor-speaker/rotation/${floorId}/toggle-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomNumber: roomNum }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) location.reload();
  });
}

/* ── Push Notifications ────────────────────────────────────────────────────────── */
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg      = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    _updatePushBell(!!existing);
    if (existing) {
      // Re-sync subscription with server on each load (handles re-login)
      fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: existing }),
      }).catch(() => {});
    }
  } catch (_) {}
}

async function togglePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported in this browser.');
    return;
  }
  const btn = document.getElementById('pushBellBtn');
  if (btn) btn.disabled = true;

  try {
    const reg      = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      // ── Unsubscribe
      await fetch('/push/unsubscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      await existing.unsubscribe();
      _updatePushBell(false);
    } else {
      // ── Subscribe
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { if (btn) btn.disabled = false; return; }

      const resp = await fetch('/push/vapid-public-key');
      const { key } = await resp.json();
      if (!key) { if (btn) btn.disabled = false; return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8(key),
      });
      await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      });
      _updatePushBell(true);
    }
  } catch (err) {
    console.error('[Push]', err);
  }
  if (btn) btn.disabled = false;
}

function _updatePushBell(isOn) {
  const btn  = document.getElementById('pushBellBtn');
  const icon = document.getElementById('pushBellIcon');
  const lbl  = document.getElementById('pushBellLabel');
  if (!btn) return;
  if (icon) icon.className = isOn ? 'bi bi-bell-fill' : 'bi bi-bell-slash';
  if (lbl)  lbl.textContent = isOn ? (lbl.dataset.on || 'Notifications on') : (lbl.dataset.off || 'Notifications off');
  btn.title = isOn ? 'Click to disable notifications' : 'Click to enable notifications';
}

function _urlB64ToUint8(b64) {
  const pad  = '='.repeat((4 - b64.length % 4) % 4);
  const raw  = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ── iOS WKWebView APNs bridge ───────────────────────────────────────────
window._registerApnsToken = function(token) {
  fetch('/push/register-apns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(r => r.json()).then(d => {
    if (d.ok) console.log('[APNs] Token registered');
  }).catch(() => {});
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('pushBellBtn')) initPushNotifications();
});
