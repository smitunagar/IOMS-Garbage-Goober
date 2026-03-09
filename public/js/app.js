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

  // Keep track of which bins already have a slot
  const existing = {};
  container.querySelectorAll('.photo-slot').forEach(s => { existing[s.dataset.bin] = s; });

  // Remove slots for bins no longer checked
  Object.keys(existing).forEach(bin => {
    if (!checkedBins.find(cb => cb.value === bin)) {
      existing[bin].remove();
      delete existing[bin];
    }
  });

  // Add slots for newly checked bins (in order)
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
        <input type="file" name="photos" class="form-control" accept="image/*" capture="environment"
               onchange="_previewSlot(this,'${bin}')">
        <div id="slot-preview-${bin}" style="display:none" class="mt-2">
          <img src="" alt="" class="slot-preview img-thumbnail" style="max-height:150px;border-radius:8px">
        </div>`;
      container.appendChild(slot);
    }
  });

  // Re-order DOM to match checkbox order
  checkedBins.forEach(cb => container.appendChild(container.querySelector(`[data-bin="${cb.value}"]`)));

  _updateSubmitState();
}

function _previewSlot(input, bin) {
  const div = document.getElementById('slot-preview-' + bin);
  if (!div) return;
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => { div.querySelector('img').src = e.target.result; div.style.display = 'block'; };
    reader.readAsDataURL(input.files[0]);
  } else {
    div.style.display = 'none';
  }
  _updateSubmitState();
}

function _updateSubmitState() {
  const btn = document.getElementById('disposal-submit-btn');
  if (!btn) return;
  const needed  = document.querySelectorAll('input[name="bins"]:checked').length;
  const filled  = Array.from(document.querySelectorAll('.photo-slot input[type="file"]'))
                       .filter(i => i.files && i.files.length > 0).length;
  btn.disabled = needed === 0 || filled < needed;
  btn.querySelector('i').className = needed > 0 && filled < needed
    ? 'bi bi-camera me-1'
    : 'bi bi-check-circle me-1';
  if (needed > 0 && filled < needed) {
    btn.textContent = '';
    const ic = document.createElement('i'); ic.className = 'bi bi-camera me-1';
    btn.appendChild(ic);
    btn.append(` Add photos (${filled}/${needed})`);
  }
}


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
  for (let i = 1; i <= 16; i++) {
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
