const complaintView = document.querySelector('#complaint-view');
const successView = document.querySelector('#success-view');
const adminView = document.querySelector('#admin-view');
const loginPanel = document.querySelector('#login-panel');
const dashboard = document.querySelector('#dashboard');
const homeNav = document.querySelector('#home-nav');
const siteFooter = document.querySelector('#site-footer');
const adminLink = document.querySelector('#admin-link');
const installAppButton = document.querySelector('#install-app');
const form = document.querySelector('#complaint-form');
const submissionIdInput = document.querySelector('#submission-id');
const formMessage = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');
const titleInput = document.querySelector('#title');
const detailsInput = document.querySelector('#details');
const photosInput = document.querySelector('#photos');
const dropZone = document.querySelector('#drop-zone');
const photoPreviews = document.querySelector('#photo-previews');
const photoCount = document.querySelector('#photo-count');
const toast = document.querySelector('#toast');
const deleteDialog = document.querySelector('#delete-dialog');
const editDialog = document.querySelector('#edit-dialog');
const backupDialog = document.querySelector('#backup-dialog');
const verifyDialog = document.querySelector('#verify-dialog');
const uploadProgress = document.querySelector('#upload-progress');

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 80 * 1024 * 1024;
const STATUSES = [
  { value: 'new', label: 'Neu', tone: 'rose' },
  { value: 'heard', label: 'Gehört', tone: 'sand' },
  { value: 'resolved', label: 'Erledigt', tone: 'green' },
];
const PRIORITIES = { low: 'Entspannt', normal: 'Normal', high: 'Wichtig', urgent: 'Dringend' };

let selectedMood = '😤';
let selectedPhotos = [];
let previewUrls = new Map();
let complaints = [];
let trashedComplaints = [];
let activeFilter = 'all';
let searchTerm = '';
let sortOrder = 'newest';
let activeCategory = '';
let activePriority = '';
let pendingDeleteId = '';
let selectedBackupFile = null;
let toastTimer;
let installPrompt = null;

function show(view) {
  [complaintView, successView, adminView].forEach((element) => element.classList.add('hidden'));
  view.classList.remove('hidden');
  const isAdmin = view === adminView;
  homeNav.classList.toggle('hidden', isAdmin || view === successView);
  adminLink.classList.toggle('hidden', isAdmin);
  siteFooter.classList.toggle('hidden', isAdmin);
  if (view === adminView) {
    loginPanel.classList.add('hidden');
    dashboard.classList.add('hidden');
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Zeit unbekannt';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function setHome() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  show(complaintView);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setAdmin() {
  if (location.hash !== '#admin') history.pushState(null, '', '#admin');
  show(adminView);
  loadDashboard();
}

function updateFormProgress() {
  const titleComplete = titleInput.value.trim().length > 0;
  const detailsComplete = detailsInput.value.trim().length > 0;
  const complete = (titleComplete ? 45 : 0) + (detailsComplete ? 45 : 0) + 10;
  document.querySelector('#progress-label').textContent = `${complete} %`;
  document.querySelector('#progress-value').style.width = `${complete}%`;
  document.querySelector('#title-count').textContent = `${titleInput.value.length} / 90`;
  document.querySelector('#details-count').textContent = `${detailsInput.value.length.toLocaleString('de-DE')} / 2.500`;
}

document.querySelectorAll('.mood').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.mood').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  selectedMood = button.dataset.mood;
  updateFormProgress();
}));

titleInput.addEventListener('input', updateFormProgress);
detailsInput.addEventListener('input', updateFormProgress);
updateFormProgress();

function readableSize(size) {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function releasePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = new Map();
}

function renderPhotoPreviews() {
  releasePreviewUrls();
  photoPreviews.replaceChildren();
  selectedPhotos.forEach((photo, index) => {
    const preview = document.createElement('div');
    preview.className = 'photo-preview';
    let thumbnail;
    if (photo.type.startsWith('image/') && !['image/heic', 'image/heif'].includes(photo.type)) {
      thumbnail = document.createElement('img');
      thumbnail.className = 'preview-thumb';
      thumbnail.alt = '';
      const url = URL.createObjectURL(photo);
      previewUrls.set(photo, url);
      thumbnail.src = url;
      thumbnail.addEventListener('error', () => {
        const icon = document.createElement('span');
        icon.className = 'preview-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▧';
        thumbnail.replaceWith(icon);
      }, { once: true });
    } else {
      thumbnail = document.createElement('span');
      thumbnail.className = 'preview-icon';
      thumbnail.setAttribute('aria-hidden', 'true');
      thumbnail.textContent = '▧';
    }

    const info = document.createElement('div');
    info.className = 'preview-info';
    const name = document.createElement('div');
    name.className = 'preview-name';
    name.textContent = photo.name;
    const size = document.createElement('div');
    size.className = 'preview-size';
    size.textContent = readableSize(photo.size);
    info.append(name, size);

    const remove = document.createElement('button');
    remove.className = 'preview-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `${photo.name} entfernen`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      selectedPhotos.splice(index, 1);
      syncPhotoInput();
      renderPhotoPreviews();
      formMessage.textContent = '';
    });
    preview.append(thumbnail, info, remove);
    photoPreviews.append(preview);
  });

  photoCount.textContent = selectedPhotos.length
    ? `${selectedPhotos.length} von 5 Fotos ausgewählt · insgesamt ${readableSize(selectedPhotos.reduce((sum, item) => sum + item.size, 0))}`
    : 'Fotos bleiben privat im geschützten Portal.';
}

function syncPhotoInput() {
  const transfer = new DataTransfer();
  selectedPhotos.forEach((photo) => transfer.items.add(photo));
  photosInput.files = transfer.files;
}

function addPhotos(files) {
  const known = new Set(selectedPhotos.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  const candidates = [...files].filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`));
  let next = [...selectedPhotos];
  let issue = '';
  for (const file of candidates) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { issue = 'Bitte wähle JPG, PNG, WebP oder HEIC aus.'; continue; }
    if (file.size > MAX_PHOTO_BYTES) { issue = 'Ein Foto ist größer als 25 MB. Bitte wähle ein kleineres aus.'; continue; }
    if (next.length >= MAX_PHOTOS) { issue = 'Es können höchstens fünf Fotos angehängt werden.'; continue; }
    if (next.reduce((sum, item) => sum + item.size, file.size) > MAX_TOTAL_PHOTO_BYTES) { issue = 'Alle Fotos zusammen dürfen höchstens 80 MB groß sein.'; continue; }
    next.push(file);
  }
  selectedPhotos = next;
  syncPhotoInput();
  renderPhotoPreviews();
  formMessage.textContent = issue;
}

photosInput.addEventListener('change', () => addPhotos(photosInput.files));
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
dropZone.addEventListener('dragleave', (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
});
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  if (event.dataTransfer?.files) addPhotos(event.dataTransfer.files);
});

function resetComposer() {
  releasePreviewUrls();
  form.reset();
  selectedPhotos = [];
  selectedMood = '😤';
  submissionIdInput.value = crypto.randomUUID();
  document.querySelectorAll('.mood').forEach((item, index) => {
    const selected = index === 0;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  renderPhotoPreviews();
  formMessage.textContent = '';
  updateFormProgress();
}

async function createThumbnail(file) {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78));
    if (!blob || !['image/webp', 'image/jpeg', 'image/png'].includes(blob.type) || blob.size > 1536 * 1024) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    }
    return blob && ['image/webp', 'image/jpeg', 'image/png'].includes(blob.type) && blob.size <= 1536 * 1024 ? blob : null;
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

submissionIdInput.value = crypto.randomUUID();

function uploadFormData(data) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/complaints');
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || selectedPhotos.length === 0) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      document.querySelector('#upload-progress-bar').style.width = `${percent}%`;
      document.querySelector('#upload-progress-text').textContent = `Fotos werden sicher übertragen · ${percent} %`;
    });
    request.addEventListener('load', () => {
      let result = {};
      try { result = JSON.parse(request.responseText); } catch { /* handled as a generic server error below */ }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result.error || 'Deine Nachricht konnte nicht gesendet werden. Bitte versuche es erneut.'));
        return;
      }
      resolve(result);
    });
    request.addEventListener('error', () => reject(new Error('Die Verbindung wurde unterbrochen. Bitte versuche es erneut.')));
    request.addEventListener('abort', () => reject(new Error('Die Übertragung wurde abgebrochen. Bitte versuche es erneut.')));
    request.send(data);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = '';
  submitButton.disabled = true;
  submitButton.querySelector('span:first-child').textContent = 'Wird sicher übermittelt …';
  uploadProgress.classList.toggle('hidden', selectedPhotos.length === 0);
  document.querySelector('#upload-progress-bar').style.width = '0%';
  document.querySelector('#upload-progress-text').textContent = 'Fotos werden sicher übertragen …';

  const data = new FormData(form);
  data.set('mood', selectedMood);
  data.delete('photos');
  data.delete('thumbnails');
  for (const [index, photo] of selectedPhotos.entries()) {
    data.append('photos', photo);
    const thumbnail = await createThumbnail(photo);
    data.append('thumbnails', thumbnail || new Blob([]), `preview-${index}.bin`);
  }
  try {
    await uploadFormData(data);

    const summary = document.querySelector('#success-summary');
    summary.replaceChildren();
    const mood = document.createElement('span');
    mood.className = 'summary-mood';
    mood.textContent = selectedMood;
    const label = document.createElement('span');
    label.textContent = `${titleInput.value.trim()} · ${document.querySelector('#category').value}`;
    summary.append(mood, label);
    resetComposer();
    show(successView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    uploadProgress.classList.add('hidden');
    submitButton.disabled = false;
    submitButton.querySelector('span:first-child').textContent = 'Beschwerde einreichen';
  }
});

document.querySelector('#new-complaint').addEventListener('click', () => {
  show(complaintView);
  document.querySelector('#einreichen').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('#success-home').addEventListener('click', setHome);
adminLink.addEventListener('click', setAdmin);
document.querySelector('#login-back').addEventListener('click', setHome);
document.querySelector('#dashboard-home').addEventListener('click', setHome);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installAppButton.classList.remove('hidden');
});
installAppButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installAppButton.classList.add('hidden');
});
window.addEventListener('appinstalled', () => installAppButton.classList.add('hidden'));
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
document.querySelectorAll('a[href="/"]').forEach((link) => link.addEventListener('click', (event) => {
  if (link.classList.contains('brand')) {
    event.preventDefault();
    setHome();
  }
}));

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Etwas ist schiefgelaufen. Bitte versuche es erneut.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function countStatuses(items) {
  return items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { new: 0, heard: 0, resolved: 0 });
}

function renderStats() {
  const counts = countStatuses(complaints);
  const values = [
    { value: complaints.length, label: 'Alle Nachrichten', caption: 'In eurem Postfach', tone: 'all' },
    { value: counts.new, label: 'Neu eingegangen', caption: 'Wartet auf ein offenes Ohr', tone: 'rose' },
    { value: counts.heard, label: 'Gehört', caption: 'Zur Kenntnis genommen', tone: 'sand' },
    { value: counts.resolved, label: 'Erledigt', caption: 'Liebevoll geklärt', tone: 'green' },
  ];
  const stats = document.querySelector('#stats');
  stats.replaceChildren();
  values.forEach((stat) => {
    const card = document.createElement('article');
    card.className = 'stat-card';
    card.dataset.tone = stat.tone;
    const topline = document.createElement('div');
    topline.className = 'stat-topline';
    topline.append(document.createTextNode(stat.label));
    const mark = document.createElement('span');
    mark.className = 'stat-mark';
    mark.setAttribute('aria-hidden', 'true');
    topline.append(mark);
    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = String(stat.value).padStart(2, '0');
    const caption = document.createElement('div');
    caption.className = 'stat-caption';
    caption.textContent = stat.caption;
    card.append(topline, value, caption);
    stats.append(card);
  });
  document.querySelector('#inbox-total').textContent = String(complaints.length);
  document.querySelectorAll('[data-count]').forEach((element) => {
    const filter = element.dataset.count;
    const count = filter === 'all' ? complaints.length : filter === 'trash' ? trashedComplaints.length : counts[filter] || 0;
    element.textContent = String(count);
  });
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeCard(item, index) {
  const isTrashed = activeFilter === 'trash';
  const card = makeElement('article', 'complaint-card');
  card.style.animationDelay = `${Math.min(index * 45, 240)}ms`;
  const top = makeElement('div', 'card-top');
  const mood = makeElement('div', 'card-mood', item.mood || '💌');
  mood.setAttribute('aria-hidden', 'true');
  const heading = makeElement('div', 'card-heading');
  const meta = makeElement('div', 'card-meta');
  meta.append(makeElement('span', '', item.category || 'Andere Angelegenheit'));
  meta.append(makeElement('span', 'meta-separator', '·'));
  meta.append(makeElement('time', '', formatDate(item.createdAt)));
  const title = makeElement('h3', 'complaint-title', item.title);
  if (item.priority && PRIORITIES[item.priority]) {
    const priority = makeElement('span', `priority priority-${item.priority}`, PRIORITIES[item.priority]);
    meta.append(makeElement('span', 'meta-separator', '·'), priority);
  }
  heading.append(meta, title);
  top.append(mood, heading);

  const details = makeElement('p', 'complaint-details', item.details);
  const children = [top, details];
  if (item.dueAt) children.push(makeElement('p', 'card-note due-note', `Wieder darauf schauen · ${formatDate(item.dueAt)}`));
  if (item.responseText) children.push(makeElement('p', 'card-note response-note', `Deine Antwort · ${item.responseText}`));
  if (item.resolutionText) children.push(makeElement('p', 'card-note resolution-note', `Gemeinsame Lösung · ${item.resolutionText}`));
  const photos = item.photos || [];
  if (photos.length) {
    const photoGrid = makeElement('div', 'photo-grid');
    photos.forEach((photo) => {
      const link = makeElement('a', 'photo-link');
      const path = `/api/photos/${encodeURIComponent(photo.id)}`;
      link.href = path;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Foto öffnen: ${photo.filename || 'Angehängtes Foto'}`);
      const image = document.createElement('img');
      image.src = photo.hasThumbnail ? `${path}?variant=thumb` : path;
      image.alt = photo.filename || 'Angehängtes Foto';
      image.loading = 'lazy';
      image.decoding = 'async';
      link.append(image);
      photoGrid.append(link);
    });
    children.push(photoGrid);
  }

  const bottom = makeElement('div', 'card-bottom');
  const status = makeElement('div', 'status-select');
  status.setAttribute('aria-label', 'Beschwerdestatus');
  const statusDot = makeElement('span', `status-dot ${item.status === 'new' ? '' : item.status}`);
  statusDot.setAttribute('aria-hidden', 'true');
  if (isTrashed) {
    status.append(statusDot, makeElement('span', '', 'Im Papierkorb'));
  } else {
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Status für ${item.title}`);
    STATUSES.forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.value === item.status;
      select.append(element);
    });
    select.addEventListener('change', () => updateComplaint(item.id, select.value, select));
    status.append(statusDot, select);
  }

  const actions = makeElement('div', 'card-actions');
  if (!isTrashed) {
    const editButton = makeElement('button', 'card-action edit', 'Bearbeiten');
    editButton.type = 'button';
    editButton.addEventListener('click', () => openEditDialog(item));
    actions.append(editButton);
  }
  if (isTrashed) {
    const restoreButton = makeElement('button', 'card-action restore', 'Wiederherstellen');
    restoreButton.type = 'button';
    restoreButton.addEventListener('click', () => restoreComplaint(item.id));
    actions.append(restoreButton);
  }
  const deleteButton = makeElement('button', 'card-action delete', isTrashed ? 'Endgültig löschen' : 'Papierkorb');
  deleteButton.type = 'button';
  deleteButton.setAttribute('aria-label', `${isTrashed ? 'Beschwerde endgültig löschen' : 'Beschwerde in den Papierkorb verschieben'}: ${item.title}`);
  const trash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  trash.setAttribute('viewBox', '0 0 24 24');
  trash.setAttribute('aria-hidden', 'true');
  const trashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trashPath.setAttribute('d', 'M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5');
  trash.append(trashPath);
  deleteButton.prepend(trash);
  deleteButton.addEventListener('click', () => openDeleteDialog(item.id));
  actions.append(deleteButton);
  bottom.append(status, actions);
  card.append(...children, bottom);
  return card;
}

function filteredComplaints() {
  const query = searchTerm.trim().toLocaleLowerCase('de-DE');
  const source = activeFilter === 'trash' ? trashedComplaints : complaints;
  return source
    .filter((item) => activeFilter === 'all' || activeFilter === 'trash' || item.status === activeFilter)
    .filter((item) => !activeCategory || item.category === activeCategory)
    .filter((item) => !activePriority || (activePriority === 'none' ? !item.priority : item.priority === activePriority))
    .filter((item) => !query || [item.title, item.details, item.category, item.priority, item.responseText, item.resolutionText].some((value) => String(value || '').toLocaleLowerCase('de-DE').includes(query)))
    .sort((a, b) => {
      if (sortOrder === 'priority') {
        const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
        const difference = (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4);
        if (difference) return difference;
      }
      return sortOrder === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function renderList() {
  const list = document.querySelector('#complaint-list');
  list.replaceChildren();
  const visible = filteredComplaints();
  const source = activeFilter === 'trash' ? trashedComplaints : complaints;
  if (!source.length) {
    const empty = makeElement('div', 'empty-state');
    const isTrash = activeFilter === 'trash';
    const isFiltered = (activeFilter !== 'all' && !isTrash) || Boolean(searchTerm || activeCategory || activePriority);
    const heading = isTrash ? 'Der Papierkorb ist leer.' : isFiltered ? 'Hier ist gerade alles ruhig.' : 'Noch ist es ganz ruhig.';
    const copy = isTrash ? 'Hier landen Beschwerden, die du aus dem Postfach nimmst.' : isFiltered ? 'Zu diesem Status gibt es im Moment keine Nachrichten.' : 'Hier erscheinen die Nachrichten, sobald etwas auf dem Herzen liegt.';
    empty.append(makeElement('span', 'empty-icon', isTrash ? '✓' : '♡'), makeElement('h3', '', heading), makeElement('p', '', copy));
    list.append(empty);
    return;
  }
  if (!visible.length) {
    const empty = makeElement('div', 'empty-state');
    empty.append(makeElement('span', 'empty-icon', '⌕'), makeElement('h3', '', 'Nichts gefunden.'), makeElement('p', '', 'Ändere den Suchbegriff oder wähle einen anderen Status.'));
    list.append(empty);
    return;
  }
  visible.forEach((item, index) => list.append(makeCard(item, index)));
}

function renderCategoryFilter() {
  const filter = document.querySelector('#category-filter');
  const current = activeCategory;
  const categories = [...new Set([...complaints, ...trashedComplaints].map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de-DE'));
  filter.replaceChildren(new Option('Alle Kategorien', ''));
  categories.forEach((category) => filter.add(new Option(category, category)));
  filter.value = categories.includes(current) ? current : '';
  activeCategory = filter.value;
}

function renderDashboard() {
  renderCategoryFilter();
  renderStats();
  renderList();
}

async function loadDashboard() {
  try {
    const session = await api('/api/admin/session');
    if (!session.authenticated) {
      showLogin();
      return;
    }
    loginPanel.classList.add('hidden');
    dashboard.classList.remove('hidden');
    document.querySelector('#complaint-list').replaceChildren(makeElement('div', 'empty-state', 'Nachrichten werden geladen …'));
    document.querySelector('#dashboard-message').textContent = '';
    const [active, trash] = await Promise.all([getAllComplaints(false), getAllComplaints(true)]);
    complaints = active;
    trashedComplaints = trash;
    renderDashboard();
    await loadHealth(false);
  } catch (error) {
    if (error.status === 401) {
      showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    } else {
      loginPanel.classList.add('hidden');
      dashboard.classList.remove('hidden');
      document.querySelector('#complaint-list').replaceChildren();
      document.querySelector('#dashboard-message').textContent = error.message;
    }
  }
}

function showLogin(message = '') {
  loginPanel.classList.remove('hidden');
  dashboard.classList.add('hidden');
  document.querySelector('#login-message').textContent = message;
}

async function getAllComplaints(trash) {
  const result = [];
  let page = 1;
  while (page <= 1000) {
    const response = await api(`/api/complaints?page=${page}&limit=60&trash=${trash ? '1' : '0'}`);
    result.push(...(response.complaints || []));
    if (!response.pagination?.hasMore) break;
    page += 1;
  }
  return result;
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const passwordField = document.querySelector('#password');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  document.querySelector('#login-message').textContent = '';
  try {
    await api('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordField.value }),
    });
    passwordField.value = '';
    await loadDashboard();
  } catch (error) {
    document.querySelector('#login-message').textContent = error.message;
    passwordField.focus();
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#refresh-dashboard').addEventListener('click', loadDashboard);
document.querySelector('#complaint-search').addEventListener('input', (event) => {
  searchTerm = event.currentTarget.value;
  renderList();
});
document.querySelector('#sort-order').addEventListener('change', (event) => {
  sortOrder = event.currentTarget.value;
  renderList();
});
document.querySelectorAll('.filter-tab').forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  });
  renderList();
}));

document.querySelector('#category-filter').addEventListener('change', (event) => {
  activeCategory = event.currentTarget.value;
  renderList();
});
document.querySelector('#priority-filter').addEventListener('change', (event) => {
  activePriority = event.currentTarget.value;
  renderList();
});

function localDateTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function openEditDialog(item) {
  document.querySelector('#edit-id').value = item.id;
  document.querySelector('#edit-title').value = item.title || '';
  document.querySelector('#edit-category').value = item.category || '';
  document.querySelector('#edit-priority').value = item.priority || '';
  document.querySelector('#edit-details').value = item.details || '';
  document.querySelector('#edit-response').value = item.responseText || '';
  document.querySelector('#edit-resolution').value = item.resolutionText || '';
  document.querySelector('#edit-due').value = localDateTimeValue(item.dueAt);
  document.querySelector('#edit-message').textContent = '';
  editDialog.showModal();
}

document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => editDialog.close()));
document.querySelector('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#edit-id').value;
  const save = document.querySelector('#save-edit');
  const dueValue = document.querySelector('#edit-due').value;
  save.disabled = true;
  document.querySelector('#edit-message').textContent = '';
  try {
    const result = await api(`/api/complaints/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.querySelector('#edit-title').value,
        category: document.querySelector('#edit-category').value,
        priority: document.querySelector('#edit-priority').value || null,
        details: document.querySelector('#edit-details').value,
        responseText: document.querySelector('#edit-response').value,
        resolutionText: document.querySelector('#edit-resolution').value,
        dueAt: dueValue ? new Date(dueValue).toISOString() : null,
      }),
    });
    const index = complaints.findIndex((item) => item.id === id);
    if (index >= 0 && result.complaint) complaints[index] = result.complaint;
    editDialog.close();
    renderDashboard();
    showToast('Änderungen gespeichert.');
  } catch (error) {
    if (error.status === 401) {
      editDialog.close();
      showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    } else {
      document.querySelector('#edit-message').textContent = error.message;
    }
  } finally {
    save.disabled = false;
  }
});

async function updateComplaint(id, status, select) {
  select.disabled = true;
  try {
    await api(`/api/complaints/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const complaint = complaints.find((item) => item.id === id);
    if (complaint) complaint.status = status;
    renderDashboard();
    showToast('Status gespeichert. Danke, dass du zugehört hast.');
  } catch (error) {
    if (error.status === 401) showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    else document.querySelector('#dashboard-message').textContent = error.message;
    select.disabled = false;
    const original = complaints.find((item) => item.id === id)?.status;
    if (original) select.value = original;
  }
}

function openDeleteDialog(id) {
  pendingDeleteId = id;
  const permanent = activeFilter === 'trash';
  deleteDialog.dataset.permanent = String(permanent);
  document.querySelector('#delete-dialog-title').textContent = permanent ? 'Endgültig löschen?' : 'In den Papierkorb?';
  document.querySelector('#delete-dialog-copy').textContent = permanent
    ? 'Diese Beschwerde und ihre Fotos werden dauerhaft entfernt. Dieser Schritt lässt sich nicht rückgängig machen.'
    : 'Du kannst die Beschwerde im Papierkorb wiederherstellen. Nach 30 Tagen werden sie und ihre Fotos automatisch gelöscht.';
  document.querySelector('#confirm-delete').textContent = permanent ? 'Endgültig löschen' : 'In Papierkorb';
  deleteDialog.showModal();
}

document.querySelector('#cancel-delete').addEventListener('click', () => deleteDialog.close());
document.querySelector('#confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const permanent = deleteDialog.dataset.permanent === 'true';
  const button = document.querySelector('#confirm-delete');
  button.disabled = true;
  button.textContent = permanent ? 'Wird endgültig gelöscht …' : 'Wird verschoben …';
  try {
    const result = await api(`/api/complaints/${encodeURIComponent(id)}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' });
    if (permanent) {
      trashedComplaints = trashedComplaints.filter((item) => item.id !== id);
    } else {
      const item = complaints.find((complaint) => complaint.id === id);
      complaints = complaints.filter((complaint) => complaint.id !== id);
      if (item) trashedComplaints.unshift({ ...item, deletedAt: result.deletedAt || new Date().toISOString() });
    }
    deleteDialog.close();
    pendingDeleteId = '';
    renderDashboard();
    if (permanent) showToast('Beschwerde und Fotos endgültig gelöscht.');
    else showToast('In den Papierkorb verschoben.', 'Rückgängig', () => restoreComplaint(id));
  } catch (error) {
    if (error.status === 401) showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    else document.querySelector('#dashboard-message').textContent = error.message;
    deleteDialog.close();
  } finally {
    button.disabled = false;
    button.textContent = deleteDialog.dataset.permanent === 'true' ? 'Endgültig löschen' : 'In Papierkorb';
  }
});
deleteDialog.addEventListener('close', () => { pendingDeleteId = ''; });

async function restoreComplaint(id) {
  try {
    await api(`/api/complaints/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    const item = trashedComplaints.find((complaint) => complaint.id === id);
    trashedComplaints = trashedComplaints.filter((complaint) => complaint.id !== id);
    if (item) complaints.unshift({ ...item, deletedAt: null });
    renderDashboard();
    showToast('Beschwerde ist wieder im Postfach.');
  } catch (error) {
    if (error.status === 401) showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    else document.querySelector('#dashboard-message').textContent = error.message;
  }
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function renderHealth(data) {
  const badge = document.querySelector('#health-badge');
  const content = document.querySelector('#health-content');
  const checked = Boolean(data.integrity);
  const healthy = Boolean(data.healthy) && !data.integrity?.error;
  badge.textContent = !healthy ? 'Bitte prüfen' : (checked ? 'Alles in Ordnung' : 'Speicher aktiv');
  badge.className = `health-badge ${healthy ? 'ok' : 'warn'}`;
  content.replaceChildren();
  const stats = makeElement('div', 'health-grid');
  const values = [
    ['Beschwerden', String(data.complaints ?? 0)],
    ['Fotos', `${data.photos?.count ?? 0} · ${formatBytes(data.photos?.bytes)}`],
    ['Offene Bereinigungen', String(data.cleanupJobs ?? 0)],
  ];
  if (data.integrity) {
    values.push(['Speicherintegrität', data.integrity.error || `${data.integrity.missingCount ?? 0} fehlend · ${data.integrity.orphanedCount ?? 0} nicht zugeordnet`]);
  }
  values.forEach(([label, value]) => {
    const item = makeElement('div', 'health-item');
    item.append(makeElement('span', 'health-label', label), makeElement('strong', 'health-value', value));
    stats.append(item);
  });
  content.append(stats);
  document.querySelector('#repair-orphans').classList.toggle('hidden', !data.integrity?.orphanedCount);
}

async function loadHealth(deep) {
  const badge = document.querySelector('#health-badge');
  try {
    const data = await api(`/api/admin/health${deep ? '?deep=1' : ''}`);
    renderHealth(data);
  } catch (error) {
    badge.textContent = 'Nicht erreichbar';
    badge.className = 'health-badge warn';
    document.querySelector('#health-content').textContent = error.message;
  }
}

document.querySelector('#deep-health').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  document.querySelector('#health-badge').textContent = 'Wird geprüft …';
  try {
    await loadHealth(true);
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelector('#repair-orphans').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api('/api/admin/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair-orphans' }),
    });
    showToast(`${result.removed} nicht zugeordnete Datei${result.removed === 1 ? '' : 'en'} bereinigt.`);
    await loadHealth(true);
  } catch (error) {
    if (error.status === 401) showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    else showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
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
  if (expectedBytes > 300 * 1024 * 1024 && !window.confirm(`Das Backup enthält ungefähr ${formatBytes(expectedBytes)} an Fotos und kann viel Arbeitsspeicher benötigen. Trotzdem fortfahren?`)) return false;
  const files = [];
  for (let index = 0; index < manifest.photos.length; index += 1) {
    const photo = manifest.photos[index];
    document.querySelector('#backup-message').textContent = `Foto ${index + 1} von ${manifest.photos.length} wird verschlüsselt vorbereitet …`;
    const response = await fetch(photo.downloadUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Foto „${photo.filename}“ konnte nicht gesichert werden.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    files.push({ id: photo.id, filename: photo.filename, contentType: photo.contentType, sha256: bytesToBase64(digest), data: bytesToBase64(bytes) });
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
  window.setTimeout(() => URL.revokeObjectURL(link.href), 15_000);
  return true;
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
  if (data?.manifest?.format !== 'booboo-portal-export' || !Array.isArray(data.manifest.complaints) || !Array.isArray(data.files)) {
    throw new Error('Das Backup enthält keine gültigen Portaldaten.');
  }
  for (const entry of data.files) {
    const fileBytes = base64ToBytes(entry.data);
    const digest = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', fileBytes)));
    if (digest !== entry.sha256) throw new Error(`Die Integritätsprüfung für „${entry.filename}“ ist fehlgeschlagen.`);
  }
  return { complaints: data.manifest.complaints.length, photos: data.files.length, exportedAt: data.manifest.exportedAt };
}

document.querySelector('#create-backup').addEventListener('click', () => {
  document.querySelector('#backup-password').value = '';
  document.querySelector('#backup-message').textContent = '';
  backupDialog.showModal();
  document.querySelector('#backup-password').focus();
});
document.querySelectorAll('[data-close-backup]').forEach((button) => button.addEventListener('click', () => backupDialog.close()));
document.querySelector('#backup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#backup-password').value;
  const submit = document.querySelector('#backup-submit');
  if (password.length < 10) {
    document.querySelector('#backup-message').textContent = 'Bitte verwende mindestens zehn Zeichen.';
    return;
  }
  submit.disabled = true;
  document.querySelector('#backup-message').textContent = 'Deine Daten werden sicher vorbereitet …';
  try {
    const completed = await createEncryptedBackup(password);
    if (completed) {
      backupDialog.close();
      showToast('Das verschlüsselte Backup wurde erstellt. Bewahre Datei und Passwort getrennt auf.');
    }
  } catch (error) {
    document.querySelector('#backup-message').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
document.querySelector('#verify-backup').addEventListener('click', () => document.querySelector('#backup-file').click());
document.querySelector('#backup-file').addEventListener('change', (event) => {
  selectedBackupFile = event.currentTarget.files[0] || null;
  event.currentTarget.value = '';
  if (!selectedBackupFile) return;
  document.querySelector('#verify-file-name').textContent = `${selectedBackupFile.name} · ${formatBytes(selectedBackupFile.size)}`;
  document.querySelector('#verify-password').value = '';
  document.querySelector('#verify-message').textContent = '';
  verifyDialog.showModal();
  document.querySelector('#verify-password').focus();
});
document.querySelectorAll('[data-close-verify]').forEach((button) => button.addEventListener('click', () => verifyDialog.close()));
document.querySelector('#verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedBackupFile) return;
  const submit = document.querySelector('#verify-submit');
  submit.disabled = true;
  document.querySelector('#verify-message').textContent = 'Verschlüsselung und Fotodateien werden geprüft …';
  try {
    const result = await openEncryptedBackup(selectedBackupFile, document.querySelector('#verify-password').value);
    verifyDialog.close();
    showToast(`Backup ist intakt · ${result.complaints} Beschwerden · ${result.photos} Fotos · ${formatDate(result.exportedAt)}`);
    selectedBackupFile = null;
  } catch (error) {
    document.querySelector('#verify-message').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

function showToast(message, actionLabel = '', onAction = null) {
  const text = document.querySelector('#toast-text');
  const action = document.querySelector('#toast-action');
  text.textContent = message;
  action.textContent = actionLabel;
  action.classList.toggle('hidden', !onAction);
  action.onclick = onAction ? async () => {
    action.disabled = true;
    try { await onAction(); } finally { action.disabled = false; hideToast(); }
  } : null;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, onAction ? 9000 : 3200);
}

function hideToast() {
  toast.classList.remove('is-visible');
  document.querySelector('#toast-action').onclick = null;
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#admin') {
    show(adminView);
    loadDashboard();
  } else if (!location.hash && !adminView.classList.contains('hidden')) {
    show(complaintView);
  }
});

if (location.hash === '#admin') {
  show(adminView);
  loadDashboard();
} else {
  show(complaintView);
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }), { threshold: .12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
}
