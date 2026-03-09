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
  }
}

/* ── Photo preview ───────────────────────────────────────────────────────── */
function previewPhoto(input) {
  const preview = document.getElementById('photoPreview');
  const img = document.getElementById('photoPreviewImg');
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      img.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.style.display = 'none';
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
