const complaintView = document.querySelector('#complaint-view');
const successView = document.querySelector('#success-view');
const adminView = document.querySelector('#admin-view');
const form = document.querySelector('#complaint-form');
const formMessage = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');
const photosInput = document.querySelector('#photos');
const photoCount = document.querySelector('#photo-count');
let selectedMood = '😤';
let adminPassword = sessionStorage.getItem('boobooAdminPassword') || '';

function show(view) {
  [complaintView, successView, adminView].forEach((element) => element.classList.add('hidden'));
  view.classList.remove('hidden');
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

document.querySelectorAll('.mood').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.mood').forEach((item) => item.classList.remove('is-selected'));
  button.classList.add('is-selected'); selectedMood = button.dataset.mood;
}));

form.addEventListener('submit', async (event) => {
  event.preventDefault(); formMessage.textContent = ''; submitButton.disabled = true; submitButton.innerHTML = 'Wird gesendet…';
  const data = new FormData(form); data.set('mood', selectedMood);
  if (photosInput.files.length > 5) { formMessage.textContent = 'Bitte wähle höchstens 5 Fotos aus.'; submitButton.disabled = false; submitButton.innerHTML = 'Beschwerde senden <span>→</span>'; return; }
  const selectedPhotos = [...photosInput.files];
  if (selectedPhotos.some((photo) => photo.size > 25 * 1024 * 1024)) { formMessage.textContent = 'Ein Foto ist größer als 25 MB. Bitte wähle ein kleineres aus.'; submitButton.disabled = false; submitButton.innerHTML = 'Beschwerde senden <span>→</span>'; return; }
  if (selectedPhotos.reduce((total, photo) => total + photo.size, 0) > 80 * 1024 * 1024) { formMessage.textContent = 'Die Fotos dürfen zusammen höchstens 80 MB groß sein.'; submitButton.disabled = false; submitButton.innerHTML = 'Beschwerde senden <span>→</span>'; return; }
  try {
    const response = await fetch('/api/complaints', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Bitte versuche es noch einmal.');
    form.reset(); photoCount.textContent = 'JPG, PNG, WebP oder HEIC · bis 25 MB je Foto · 80 MB zusammen'; selectedMood = '😤'; document.querySelectorAll('.mood').forEach((item, index) => item.classList.toggle('is-selected', index === 0)); show(successView);
  } catch (error) { formMessage.textContent = error.message; } finally { submitButton.disabled = false; submitButton.innerHTML = 'Beschwerde senden <span>→</span>'; }
});

photosInput.addEventListener('change', () => {
  const count = photosInput.files.length;
  photoCount.textContent = count ? `${count} Foto${count === 1 ? '' : 's'} ausgewählt` : 'JPG, PNG, WebP oder HEIC · bis 25 MB je Foto · 80 MB zusammen';
});

document.querySelector('#new-complaint').addEventListener('click', () => show(complaintView));
document.querySelector('#admin-link').addEventListener('click', () => { history.replaceState(null, '', '#admin'); show(adminView); });
document.querySelector('#back-home').addEventListener('click', () => { history.replaceState(null, '', location.pathname); show(complaintView); });

function makeCard(item) {
  const card = document.createElement('article'); card.className = 'complaint-card';
  const escape = (text) => String(text).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  const priorities = { low: 'Entspannt', normal: 'Normal', high: 'Wichtig', urgent: 'Dringend' };
  const priority = item.priority ? `<span class="priority priority-${escape(item.priority)}">${escape(priorities[item.priority] || item.priority)}</span>` : '';
  const photos = (item.photos || []).map((photo) => `<a class="photo-link" href="/api/photos/${encodeURIComponent(photo.id)}" target="_blank" rel="noopener"><img src="/api/photos/${encodeURIComponent(photo.id)}" alt="${escape(photo.filename || 'Angehängtes Foto')}" loading="lazy" /></a>`).join('');
  card.innerHTML = `<div class="complaint-top"><div class="complaint-mood">${escape(item.mood)}</div><div><h3 class="complaint-title">${escape(item.title)}</h3><div class="meta">${escape(item.category)} · ${formatDate(item.createdAt)} ${priority}</div></div></div><p>${escape(item.details)}</p>${photos ? `<div class="photo-grid">${photos}</div>` : ''}<div class="actions"><button class="status-button ${item.status === 'new' ? 'active' : ''}" data-status="new">Neu</button><button class="status-button ${item.status === 'heard' ? 'active' : ''}" data-status="heard">Gehört</button><button class="status-button ${item.status === 'resolved' ? 'active' : ''}" data-status="resolved">Erledigt</button><button class="delete-button">Löschen</button></div>`;
  card.querySelectorAll('.status-button').forEach((button) => button.addEventListener('click', () => updateComplaint(item.id, button.dataset.status)));
  card.querySelector('.delete-button').addEventListener('click', () => { if (confirm('Diese Beschwerde endgültig löschen?')) deleteComplaint(item.id); });
  return card;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), 'x-admin-password': adminPassword } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Etwas ist schiefgelaufen.'); return data;
}

async function loadDashboard() {
  const list = document.querySelector('#complaint-list'); list.innerHTML = '<div class="empty">Beschwerden werden geladen…</div>';
  try {
    const { complaints } = await api('/api/complaints');
    document.querySelector('#login-form').classList.add('hidden'); document.querySelector('#dashboard').classList.remove('hidden');
    const counts = { new:0, heard:0, resolved:0 }; complaints.forEach((item) => counts[item.status]++);
    document.querySelector('#stats').innerHTML = `<div class="stat"><strong>${counts.new}</strong><span>neu</span></div><div class="stat"><strong>${counts.heard}</strong><span>gehört</span></div><div class="stat"><strong>${counts.resolved}</strong><span>erledigt</span></div>`;
    list.innerHTML = ''; if (!complaints.length) { list.innerHTML = '<div class="empty">Noch keine Beschwerden. Du machst dich offenbar gut.</div>'; return; }
    complaints.forEach((item) => list.appendChild(makeCard(item)));
  } catch (error) { sessionStorage.removeItem('boobooAdminPassword'); adminPassword = ''; document.querySelector('#login-message').textContent = error.message; document.querySelector('#login-form').classList.remove('hidden'); document.querySelector('#dashboard').classList.add('hidden'); }
}

async function updateComplaint(id, status) { try { await api(`/api/complaints/${id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ status }) }); loadDashboard(); } catch (error) { alert(error.message); } }
async function deleteComplaint(id) { try { await api(`/api/complaints/${id}`, { method:'DELETE' }); loadDashboard(); } catch (error) { alert(error.message); } }

document.querySelector('#login-form').addEventListener('submit', (event) => { event.preventDefault(); adminPassword = document.querySelector('#password').value; sessionStorage.setItem('boobooAdminPassword', adminPassword); loadDashboard(); });
if (location.hash === '#admin') { show(adminView); if (adminPassword) loadDashboard(); }
