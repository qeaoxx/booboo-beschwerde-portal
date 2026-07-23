const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const views = {
  complaint: $('#complaint-view'),
  success: $('#success-view'),
  admin: $('#admin-view'),
};
const form = $('#complaint-form');
const formMessage = $('#form-message');
const submitButton = $('#submit-button');
const photosInput = $('#photos');
const photoCount = $('#photo-count');
const photoPreviews = $('#photo-previews');
const progressWrap = $('#upload-progress');
const progressBar = $('#upload-progress-bar');
const progressText = $('#upload-progress-text');
const detailsInput = $('#details');
const detailsCount = $('#details-count');

const state = {
  selectedMood: '😤',
  selectedFiles: [],
  previewUrls: [],
  submissionId: crypto.randomUUID(),
  adminAuthenticated: false,
  complaints: [],
  stats: { new: 0, heard: 0, resolved: 0, deleted: 0, total: 0 },
  categories: [],
  page: 1,
  hasMore: false,
  loading: false,
  undo: null,
  toastTimer: null,
  health: null,
};

function show(view) {
  Object.values(views).forEach((element) => element.classList.add('hidden'));
  view.classList.remove('hidden');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function setProgress(percent, text) {
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressText.textContent = text;
}

function resetProgress() {
  progressWrap.classList.add('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = 'Fotos werden vorbereitet…';
}

function resetPhotoSelection() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
  state.selectedFiles = [];
  photosInput.value = '';
  photoPreviews.innerHTML = '';
  photoCount.textContent = 'JPG, PNG, WebP oder HEIC · werden datensparsam optimiert';
}

function updateMoodButtons() {
  $$('.mood').forEach((button) => {
    const selected = button.dataset.mood === state.selectedMood;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

$$('.mood').forEach((button) => button.addEventListener('click', () => {
  state.selectedMood = button.dataset.mood;
  updateMoodButtons();
}));

detailsInput.addEventListener('input', () => {
  detailsCount.textContent = String(detailsInput.value.length);
});

function renderPhotoPreviews() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
  photoPreviews.innerHTML = '';
  state.selectedFiles.forEach((file, index) => {
    const card = document.createElement('article');
    card.className = 'preview-card';
    const image = document.createElement('img');
    const url = URL.createObjectURL(file);
    state.previewUrls.push(url);
    image.src = url;
    image.alt = `Vorschau von ${file.name}`;
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const size = document.createElement('span');
    size.textContent = formatBytes(file.size);
    info.append(name, size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'preview-remove';
    remove.setAttribute('aria-label', `${file.name} entfernen`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.selectedFiles.splice(index, 1);
      renderPhotoPreviews();
    });
    card.append(image, info, remove);
    photoPreviews.append(card);
  });
  const count = state.selectedFiles.length;
  photoCount.textContent = count
    ? `${count} Foto${count === 1 ? '' : 's'} ausgewählt · ${formatBytes(state.selectedFiles.reduce((sum, file) => sum + file.size, 0))}`
    : 'JPG, PNG, WebP oder HEIC · werden datensparsam optimiert';
}

photosInput.addEventListener('change', () => {
  const incoming = [...photosInput.files];
  if (incoming.length > 5) {
    formMessage.textContent = 'Bitte wähle höchstens 5 Fotos aus.';
    state.selectedFiles = incoming.slice(0, 5);
  } else {
    formMessage.textContent = '';
    state.selectedFiles = incoming;
  }
  renderPhotoPreviews();
});

async function loadBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function optimizePhoto(file) {
  try {
    const source = await loadBitmap(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('Bild kann nicht gelesen werden.');
    const scale = Math.min(1, 2560 / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.getContext('2d', { alpha: true }).drawImage(source, 0, 0, targetWidth, targetHeight);
    const optimizedBlob = await canvasBlob(canvas, 'image/webp', 0.86);

    const thumbScale = Math.min(1, 480 / Math.max(width, height));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = Math.max(1, Math.round(width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(height * thumbScale));
    thumbCanvas.getContext('2d', { alpha: true }).drawImage(source, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasBlob(thumbCanvas, 'image/webp', 0.76);
    if (typeof source.close === 'function') source.close();

    const useOptimized = optimizedBlob && optimizedBlob.size < file.size;
    const output = useOptimized
      ? new File([optimizedBlob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified })
      : file;
    const thumbnail = thumbBlob
      ? new File([thumbBlob], `thumb-${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
      : new File([], 'no-thumbnail', { type: 'application/octet-stream' });
    return { file: output, thumbnail, originalSize: file.size, optimizedSize: output.size };
  } catch {
    return {
      file,
      thumbnail: new File([], 'no-thumbnail', { type: 'application/octet-stream' }),
      originalSize: file.size,
      optimizedSize: file.size,
    };
  }
}

function uploadFormData(data, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/complaints');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      const result = xhr.response || (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(result || {});
      else reject(new Error(result?.error || 'Bitte versuche es noch einmal.'));
    });
    xhr.addEventListener('error', () => reject(new Error('Netzwerkfehler. Bitte prüfe deine Verbindung.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload abgebrochen.')));
    xhr.send(data);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  formMessage.textContent = '';
  submitButton.disabled = true;
  submitButton.innerHTML = 'Wird sicher gespeichert…';
  try {
    const prepared = [];
    for (let index = 0; index < state.selectedFiles.length; index += 1) {
      setProgress(5 + Math.round((index / Math.max(1, state.selectedFiles.length)) * 35), `Foto ${index + 1} von ${state.selectedFiles.length} wird optimiert…`);
      prepared.push(await optimizePhoto(state.selectedFiles[index]));
    }
    const total = prepared.reduce((sum, item) => sum + item.file.size, 0);
    if (prepared.some((item) => item.file.size > 25 * 1024 * 1024)) throw new Error('Ein Foto ist nach der Verarbeitung größer als 25 MB.');
    if (total > 80 * 1024 * 1024) throw new Error('Die Fotos sind zusammen größer als 80 MB.');

    const data = new FormData();
    data.set('submissionId', state.submissionId);
    data.set('title', $('#title').value);
    data.set('details', detailsInput.value);
    data.set('category', $('#category').value);
    data.set('priority', $('#priority').value);
    data.set('mood', state.selectedMood);
    for (const item of prepared) {
      data.append('photos', item.file, item.file.name);
      data.append('thumbnails', item.thumbnail, item.thumbnail.name);
    }
    setProgress(42, 'Beschwerde wird verschlüsselt übertragen und gespeichert…');
    await uploadFormData(data, (ratio) => setProgress(42 + Math.round(ratio * 55), `Upload läuft… ${Math.round(ratio * 100)} %`));
    setProgress(100, 'Sicher gespeichert.');
    form.reset();
    resetPhotoSelection();
    state.selectedMood = '😤';
    state.submissionId = crypto.randomUUID();
    detailsCount.textContent = '0';
    updateMoodButtons();
    show(views.success);
    views.success.focus();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Beschwerde senden <span>→</span>';
    setTimeout(resetProgress, 800);
  }
});

$('#new-complaint').addEventListener('click', () => {
  show(views.complaint);
  $('#title').focus();
});

function setAdminRoute(enabled) {
  history.replaceState(null, '', enabled ? '#admin' : location.pathname + location.search);
}

$('#admin-link').addEventListener('click', () => {
  setAdminRoute(true);
  show(views.admin);
  initializeAdmin();
});
$('#back-home').addEventListener('click', () => {
  setAdminRoute(false);
  show(views.complaint);
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#admin') {
    show(views.admin);
    initializeAdmin();
  } else {
    show(views.complaint);
  }
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/session') lockDashboard();
    throw new Error(data.error || 'Etwas ist schiefgelaufen.');
  }
  return data;
}

function lockDashboard() {
  state.adminAuthenticated = false;
  state.complaints = [];
  $('#dashboard').classList.add('hidden');
  $('#login-form').classList.remove('hidden');
  $('#password').value = '';
}

async function initializeAdmin() {
  if (state.adminAuthenticated) return;
  try {
    const session = await api('/api/admin/session');
    if (session.authenticated) {
      state.adminAuthenticated = true;
      $('#login-form').classList.add('hidden');
      $('#dashboard').classList.remove('hidden');
      await Promise.all([loadDashboard(true), loadHealth(false)]);
    } else {
      lockDashboard();
    }
  } catch {
    lockDashboard();
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-form .primary');
  const message = $('#login-message');
  button.disabled = true;
  message.textContent = '';
  try {
    await api('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#password').value }),
    });
    state.adminAuthenticated = true;
    $('#password').value = '';
    $('#login-form').classList.add('hidden');
    $('#dashboard').classList.remove('hidden');
    await Promise.all([loadDashboard(true), loadHealth(false)]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#admin-logout').addEventListener('click', async () => {
  await api('/api/admin/session', { method: 'DELETE' }).catch(() => undefined);
  lockDashboard();
  $('#password').focus();
});

function filterQuery(page) {
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  const values = {
    q: $('#filter-search').value.trim(),
    status: $('#filter-status').value,
    priority: $('#filter-priority').value,
    category: $('#filter-category').value,
    sort: $('#filter-sort').value,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  if ($('#filter-trash').checked) params.set('trash', '1');
  return params.toString();
}

async function loadDashboard(reset = true) {
  if (state.loading) return;
  state.loading = true;
  const list = $('#complaint-list');
  if (reset) {
    state.page = 1;
    list.innerHTML = '<div class="empty">Beschwerden werden geladen…</div>';
  }
  try {
    const page = reset ? 1 : state.page + 1;
    const data = await api(`/api/complaints?${filterQuery(page)}`);
    state.complaints = reset ? data.complaints : [...state.complaints, ...data.complaints];
    state.stats = data.stats;
    state.categories = data.categories;
    state.page = page;
    state.hasMore = data.pagination.hasMore;
    renderStats();
    renderCategoryFilter();
    renderComplaints();
    $('#load-more').classList.toggle('hidden', !state.hasMore);
  } catch (error) {
    list.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  } finally {
    state.loading = false;
  }
}

function renderStats() {
  const definitions = [
    ['new', 'neu'], ['heard', 'gehört'], ['resolved', 'erledigt'], ['deleted', 'Papierkorb'], ['total', 'gesamt'],
  ];
  $('#stats').replaceChildren(...definitions.map(([key, label]) => {
    const item = document.createElement('div');
    item.className = 'stat';
    const strong = document.createElement('strong');
    strong.textContent = String(state.stats[key] || 0);
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    return item;
  }));
}

function renderCategoryFilter() {
  const select = $('#filter-category');
  const current = select.value;
  select.replaceChildren(new Option('Alle', ''), ...state.categories.map((category) => new Option(category, category)));
  if (state.categories.includes(current)) select.value = current;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function notificationLabel(notification) {
  if (!notification) return '';
  const labels = { sent: 'Telegram gesendet', failed: 'Telegram fehlgeschlagen', pending: 'Telegram wartet', queued: 'Telegram eingeplant', sending: 'Telegram sendet', cancelled: 'Telegram abgebrochen' };
  return `<span class="notification-status notification-${escapeHtml(notification.status)}">${escapeHtml(labels[notification.status] || notification.status)}</span>`;
}

function makeCard(item) {
  const card = document.createElement('article');
  card.className = `complaint-card${item.priority === 'urgent' ? ' is-urgent' : ''}`;
  card.dataset.id = item.id;
  const priorities = { low: 'Entspannt', normal: 'Normal', high: 'Wichtig', urgent: 'Dringend' };
  const priority = item.priority ? `<span class="priority priority-${escapeHtml(item.priority)}">${escapeHtml(priorities[item.priority])}</span>` : '';
  const photos = (item.photos || []).map((photo) => {
    const heic = /heic|heif/i.test(photo.contentType);
    const content = heic && !photo.hasThumbnail
      ? `<span class="heic-placeholder">HEIC-Foto<br>antippen zum Öffnen</span>`
      : `<img src="/api/photos/${encodeURIComponent(photo.id)}?variant=thumb" alt="${escapeHtml(photo.filename || 'Angehängtes Foto')}" loading="lazy" />`;
    return `<a class="photo-link" href="/api/photos/${encodeURIComponent(photo.id)}" target="_blank" rel="noopener">${content}</a>`;
  }).join('');
  const due = item.dueAt ? ` · Fällig ${formatDate(item.dueAt)}` : '';
  const response = item.responseText ? `<div class="response-box"><strong>Antwort:</strong><br>${escapeHtml(item.responseText)}</div>` : '';
  const resolution = item.resolutionText ? `<div class="response-box"><strong>Lösung:</strong><br>${escapeHtml(item.resolutionText)}</div>` : '';
  const deleted = Boolean(item.deletedAt);
  card.innerHTML = `
    <div class="complaint-top"><div class="complaint-mood">${escapeHtml(item.mood)}</div><div><h3 class="complaint-title">${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(item.category)} · ${formatDate(item.createdAt)}${due} ${priority}${notificationLabel(item.notification)}</div></div></div>
    <p class="complaint-details">${escapeHtml(item.details)}</p>${response}${resolution}
    ${photos ? `<div class="photo-grid">${photos}</div>` : ''}
    <div class="actions">
      ${deleted ? '<button class="status-button restore-button">Wiederherstellen</button><button class="delete-button permanent-delete">Endgültig löschen</button>' : `
        <button class="status-button ${item.status === 'new' ? 'active' : ''}" data-status="new">Neu</button>
        <button class="status-button ${item.status === 'heard' ? 'active' : ''}" data-status="heard">Gehört</button>
        <button class="status-button ${item.status === 'resolved' ? 'active' : ''}" data-status="resolved">Erledigt</button>
        <button class="text-button expand-button">Mehr anzeigen</button>
        <button class="text-button edit-button">Bearbeiten</button>
        <button class="delete-button">Papierkorb</button>`}
    </div>`;

  card.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => updateStatus(item, button.dataset.status)));
  card.querySelector('.expand-button')?.addEventListener('click', (event) => {
    card.classList.toggle('expanded');
    event.currentTarget.textContent = card.classList.contains('expanded') ? 'Weniger anzeigen' : 'Mehr anzeigen';
  });
  card.querySelector('.edit-button')?.addEventListener('click', () => openEditDialog(item));
  card.querySelector('.delete-button:not(.permanent-delete)')?.addEventListener('click', () => softDelete(item));
  card.querySelector('.restore-button')?.addEventListener('click', () => restoreComplaint(item.id));
  card.querySelector('.permanent-delete')?.addEventListener('click', () => permanentDelete(item));
  return card;
}

function renderComplaints() {
  const list = $('#complaint-list');
  list.innerHTML = '';
  if (!state.complaints.length) {
    list.innerHTML = `<div class="empty">${$('#filter-trash').checked ? 'Der Papierkorb ist leer.' : 'Keine passenden Beschwerden gefunden.'}</div>`;
    return;
  }
  state.complaints.forEach((item) => list.append(makeCard(item)));
}

async function updateStatus(item, status) {
  const previous = item.status;
  if (previous === status) return;
  try {
    const { complaint } = await api(`/api/complaints/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    Object.assign(item, complaint);
    state.stats[previous] = Math.max(0, state.stats[previous] - 1);
    state.stats[status] += 1;
    renderStats();
    renderComplaints();
    showToast('Status wurde gespeichert.');
  } catch (error) {
    showToast(error.message);
  }
}

async function softDelete(item) {
  if (!confirm('Diese Beschwerde in den Papierkorb verschieben? Sie kann 30 Tage lang wiederhergestellt werden.')) return;
  try {
    await api(`/api/complaints/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    state.complaints = state.complaints.filter((entry) => entry.id !== item.id);
    state.stats[item.status] = Math.max(0, state.stats[item.status] - 1);
    state.stats.deleted += 1;
    renderStats();
    renderComplaints();
    state.undo = { id: item.id };
    showToast('Beschwerde wurde in den Papierkorb verschoben.', 'Rückgängig', () => restoreComplaint(item.id, true));
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreComplaint(id, fromUndo = false) {
  try {
    await api(`/api/complaints/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    showToast('Beschwerde wurde wiederhergestellt.');
    await loadDashboard(true);
    if (fromUndo) state.undo = null;
  } catch (error) {
    showToast(error.message);
  }
}

async function permanentDelete(item) {
  if (!confirm('Diese Beschwerde und alle Fotos endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return;
  try {
    await api(`/api/complaints/${encodeURIComponent(item.id)}?permanent=1`, { method: 'DELETE' });
    state.complaints = state.complaints.filter((entry) => entry.id !== item.id);
    state.stats.deleted = Math.max(0, state.stats.deleted - 1);
    state.stats.total = Math.max(0, state.stats.total - 1);
    renderStats();
    renderComplaints();
    showToast('Beschwerde wurde endgültig gelöscht.');
  } catch (error) {
    showToast(error.message);
  }
}

function localDateTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function openEditDialog(item) {
  $('#edit-id').value = item.id;
  $('#edit-title').value = item.title;
  $('#edit-details').value = item.details;
  $('#edit-priority').value = item.priority || '';
  $('#edit-response').value = item.responseText || '';
  $('#edit-resolution').value = item.resolutionText || '';
  $('#edit-due').value = localDateTimeValue(item.dueAt);
  const categorySelect = $('#edit-category');
  categorySelect.replaceChildren(...state.categories.map((category) => new Option(category, category)));
  categorySelect.value = item.category;
  $('#edit-message').textContent = '';
  $('#edit-dialog').showModal();
  $('#edit-title').focus();
}

$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#edit-id').value;
  const button = $('#save-edit');
  button.disabled = true;
  $('#edit-message').textContent = '';
  try {
    const due = $('#edit-due').value ? new Date($('#edit-due').value).toISOString() : null;
    const { complaint } = await api(`/api/complaints/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: $('#edit-title').value,
        details: $('#edit-details').value,
        category: $('#edit-category').value,
        priority: $('#edit-priority').value || null,
        responseText: $('#edit-response').value,
        resolutionText: $('#edit-resolution').value,
        dueAt: due,
      }),
    });
    const index = state.complaints.findIndex((item) => item.id === id);
    if (index >= 0) state.complaints[index] = complaint;
    renderComplaints();
    $('#edit-dialog').close();
    showToast('Änderungen wurden gespeichert.');
  } catch (error) {
    $('#edit-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

let filterTimer;
$('#filter-search').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadDashboard(true), 250);
});
['#filter-status', '#filter-priority', '#filter-category', '#filter-sort', '#filter-trash'].forEach((selector) => {
  $(selector).addEventListener('change', () => loadDashboard(true));
});
$('#load-more').addEventListener('click', () => loadDashboard(false));
$('#refresh-dashboard').addEventListener('click', () => Promise.all([loadDashboard(true), loadHealth(false)]));

function renderHealth(data) {
  state.health = data;
  const badge = $('#health-badge');
  badge.textContent = data.healthy ? 'Alles okay' : 'Aufmerksamkeit';
  badge.className = `health-badge ${data.healthy ? 'ok' : 'warn'}`;
  const notification = data.notifications;
  const integrity = data.integrity;
  $('#health-content').innerHTML = `
    <div class="health-grid">
      <div class="health-item"><strong>Telegram</strong><br>${data.telegramPaired ? 'Verbunden' : 'Nicht verbunden'}</div>
      <div class="health-item"><strong>Benachrichtigungen</strong><br>${notification.sent} gesendet · ${notification.pending + notification.queued + notification.sending} offen · ${notification.failed} fehlgeschlagen</div>
      <div class="health-item"><strong>Fotos</strong><br>${data.photos.count} · ${formatBytes(data.photos.bytes)}</div>
      <div class="health-item"><strong>Bereinigung</strong><br>${data.cleanupJobs} offene Jobs</div>
      ${integrity ? `<div class="health-item"><strong>Speicherintegrität</strong><br>${integrity.error || `${integrity.missingCount} fehlend · ${integrity.orphanedCount} verwaist`}</div>` : ''}
      <div class="health-item"><strong>Letzte Telegram-Nachricht</strong><br>${formatDate(data.lastNotificationSentAt)}</div>
    </div>
    ${data.failedNotifications.length ? `<p><strong>Fehlgeschlagene Nachrichten:</strong></p>${data.failedNotifications.map((item) => `<p>${escapeHtml(item.title)} · ${item.attempts} Versuche <button class="pill retry-notification" data-id="${escapeHtml(item.id)}">Erneut senden</button></p>`).join('')}` : ''}`;
  $$('.retry-notification', $('#health-content')).forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/admin/notifications/${encodeURIComponent(button.dataset.id)}/retry`, { method: 'POST' });
      showToast('Benachrichtigung wurde erneut eingeplant.');
      await loadHealth(false);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }));
  $('#repair-orphans').classList.toggle('hidden', !integrity?.orphanedCount);
}

async function loadHealth(deep) {
  try {
    const data = await api(`/api/admin/health${deep ? '?deep=1' : ''}`);
    renderHealth(data);
  } catch (error) {
    $('#health-badge').textContent = 'Fehler';
    $('#health-badge').className = 'health-badge warn';
    $('#health-content').textContent = error.message;
  }
}

$('#deep-health').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try { await loadHealth(true); } finally { event.currentTarget.disabled = false; }
});
$('#repair-orphans').addEventListener('click', async () => {
  if (!confirm('Nur nachweislich verwaiste KV-Dateien löschen? Bestehende Beschwerden werden nicht verändert.')) return;
  try {
    const result = await api('/api/admin/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair-orphans' }),
    });
    showToast(`${result.removed} verwaiste Dateien wurden entfernt.`);
    await loadHealth(true);
  } catch (error) {
    showToast(error.message);
  }
});

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function compressBytes(bytes) {
  if (!('CompressionStream' in window)) return { bytes, compressed: false };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true };
}

async function decompressBytes(bytes, compressed) {
  if (!compressed) return bytes;
  if (!('DecompressionStream' in window)) throw new Error('Dieser Browser kann das komprimierte Backup nicht öffnen.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deriveBackupKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function createEncryptedBackup(password) {
  const manifest = await api('/api/admin/export');
  const expectedBytes = manifest.photos.reduce((sum, photo) => sum + photo.size, 0);
  if (expectedBytes > 300 * 1024 * 1024 && !confirm(`Das Backup enthält ungefähr ${formatBytes(expectedBytes)} an Fotos und kann viel Arbeitsspeicher benötigen. Trotzdem fortfahren?`)) return;
  const files = [];
  for (let index = 0; index < manifest.photos.length; index += 1) {
    const photo = manifest.photos[index];
    $('#backup-message').textContent = `Foto ${index + 1} von ${manifest.photos.length} wird gesichert…`;
    const response = await fetch(photo.downloadUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Foto „${photo.filename}“ konnte nicht gesichert werden.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    files.push({
      id: photo.id,
      filename: photo.filename,
      contentType: photo.contentType,
      sha256: bytesToBase64(digest),
      data: bytesToBase64(bytes),
    });
  }
  const payload = new TextEncoder().encode(JSON.stringify({ manifest, files }));
  const packed = await compressBytes(payload);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed.bytes));
  const header = new TextEncoder().encode(JSON.stringify({
    magic: 'BOOBOO-BACKUP', version: 1, compressed: packed.compressed,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), createdAt: new Date().toISOString(),
  }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length, false);
  const blob = new Blob([length, header, cipher], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `booboo-backup-${new Date().toISOString().slice(0, 10)}.booboo`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 15_000);
}

async function openEncryptedBackup(file, password) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 5) throw new Error('Die Datei ist kein gültiges Booboo-Backup.');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  const headerEnd = 4 + headerLength;
  if (headerEnd >= bytes.length) throw new Error('Das Backup ist beschädigt.');
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(4, headerEnd)));
  if (header.magic !== 'BOOBOO-BACKUP' || header.version !== 1) throw new Error('Unbekanntes Backup-Format.');
  const key = await deriveBackupKey(password, base64ToBytes(header.salt));
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(header.iv) }, key, bytes.slice(headerEnd)));
  } catch {
    throw new Error('Falsches Passwort oder beschädigtes Backup.');
  }
  plain = await decompressBytes(plain, header.compressed);
  const data = JSON.parse(new TextDecoder().decode(plain));
  if (data?.manifest?.format !== 'booboo-portal-export' || !Array.isArray(data.files)) throw new Error('Das Backup enthält keine gültigen Portaldaten.');
  for (const entry of data.files) {
    const fileBytes = base64ToBytes(entry.data);
    const digest = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', fileBytes)));
    if (digest !== entry.sha256) throw new Error(`Die Integritätsprüfung für „${entry.filename}“ ist fehlgeschlagen.`);
  }
  return { complaints: data.manifest.complaints.length, photos: data.files.length, exportedAt: data.manifest.exportedAt };
}

$('#create-backup').addEventListener('click', () => {
  $('#backup-password').value = '';
  $('#backup-message').textContent = '';
  $('#backup-dialog').showModal();
  $('#backup-password').focus();
});
$('#backup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#backup-password').value;
  if (password.length < 10) {
    $('#backup-message').textContent = 'Bitte verwende mindestens 10 Zeichen.';
    return;
  }
  $('#backup-submit').disabled = true;
  try {
    await createEncryptedBackup(password);
    $('#backup-dialog').close();
    showToast('Das verschlüsselte Backup wurde erstellt.');
  } catch (error) {
    $('#backup-message').textContent = error.message;
  } finally {
    $('#backup-submit').disabled = false;
  }
});
$('#verify-backup').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async () => {
  const file = $('#backup-file').files[0];
  $('#backup-file').value = '';
  if (!file) return;
  const password = prompt('Backup-Passwort eingeben:');
  if (!password) return;
  try {
    const result = await openEncryptedBackup(file, password);
    alert(`Backup ist vollständig und lesbar.\n${result.complaints} Beschwerden\n${result.photos} Fotos\nExport: ${formatDate(result.exportedAt)}`);
  } catch (error) {
    alert(error.message);
  }
});

function showToast(text, actionLabel = '', action = null) {
  clearTimeout(state.toastTimer);
  const toast = $('#toast');
  $('#toast-text').textContent = text;
  const button = $('#toast-action');
  button.classList.toggle('hidden', !action);
  button.textContent = actionLabel;
  button.onclick = action ? async () => { await action(); hideToast(); } : null;
  toast.classList.remove('hidden');
  state.toastTimer = setTimeout(hideToast, action ? 10_000 : 4_000);
}

function hideToast() {
  $('#toast').classList.add('hidden');
  $('#toast-action').onclick = null;
}

if (location.hash === '#admin') {
  show(views.admin);
  initializeAdmin();
}
