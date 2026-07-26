const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const THEME_KEY = 'booboo-theme';
const root = document.documentElement;
const themeToggle = $('#theme-toggle');
const installButton = $('#install-app');
const themeMeta = $('meta[name="theme-color"]');
const viewVisibility = new WeakMap();
let installPrompt = null;
let successBurstShown = false;

function readSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function preferredTheme() {
  return readSavedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme, persist = true) {
  root.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Appearance still works for this page view. */ }
  }
  const dark = theme === 'dark';
  if (themeToggle) {
    themeToggle.setAttribute('aria-label', dark ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren');
    themeToggle.setAttribute('title', dark ? 'Helles Design' : 'Dunkles Design');
    themeToggle.innerHTML = dark
      ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20.4 15.3A8.5 8.5 0 0 1 8.7 3.6 8.5 8.5 0 1 0 20.4 15.3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }
  if (themeMeta) themeMeta.content = dark ? '#170d13' : '#d93578';
}

applyTheme(preferredTheme(), false);
themeToggle?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
  if (!readSavedTheme()) applyTheme(event.matches ? 'dark' : 'light', false);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton?.classList.remove('hidden');
});

installButton?.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => undefined);
  installPrompt = null;
  installButton?.classList.add('hidden');
});

window.addEventListener('appinstalled', () => installButton?.classList.add('hidden'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  });
}

function updateGreeting() {
  const greeting = $('#dashboard-greeting');
  const subline = $('#dashboard-subline');
  if (!greeting || !subline) return;
  const hour = new Date().getHours();
  const phrase = hour < 5 ? 'Noch wach, Booboo?' : hour < 11 ? 'Guten Morgen, Booboo' : hour < 18 ? 'Alles im Blick, Booboo' : 'Guten Abend, Booboo';
  greeting.textContent = phrase;
  subline.textContent = 'Deine private Inbox für alles, was gehört und geklärt werden soll.';
}

function triggerHeartBurst() {
  const burst = $('#heart-burst');
  if (!burst || successBurstShown) return;
  successBurstShown = true;
  burst.replaceChildren(...Array.from({ length: 5 }, () => {
    const heart = document.createElement('span');
    heart.textContent = '♥';
    heart.setAttribute('aria-hidden', 'true');
    return heart;
  }));
}

function syncViews() {
  $$('#complaint-view, #success-view, #admin-view').forEach((view) => {
    const visible = !view.classList.contains('hidden');
    const previous = viewVisibility.get(view);
    viewVisibility.set(view, visible);
    if (previous === visible) return;

    if (visible) {
      view.classList.remove('view-enter');
      requestAnimationFrame(() => view.classList.add('view-enter'));
      if (view.id === 'success-view') triggerHeartBurst();
      if (view.id === 'admin-view') updateGreeting();
    } else if (view.id === 'success-view') {
      successBurstShown = false;
      $('#heart-burst')?.replaceChildren();
    }
  });
}

function decorateStats() {
  const stats = $('#stats');
  if (!stats) return;
  const map = {
    neu: 'stat-new',
    gehört: 'stat-heard',
    erledigt: 'stat-resolved',
    papierkorb: 'stat-deleted',
    gesamt: 'stat-total',
  };
  $$('.stat', stats).forEach((item) => {
    const label = $('span', item)?.textContent?.trim().toLowerCase();
    for (const className of Object.values(map)) item.classList.remove(className);
    if (map[label]) item.classList.add(map[label]);
  });
}

function buildCardMenu(card) {
  if ($('.card-menu', card)) return;
  const actions = $('.actions', card);
  if (!actions) return;
  const movable = [...new Set([$('.edit-button', actions), $('.delete-button', actions), $('.permanent-delete', actions)].filter(Boolean))];
  if (!movable.length) return;

  const menu = document.createElement('details');
  menu.className = 'card-menu';
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', 'Weitere Aktionen');
  summary.textContent = '•••';
  const popover = document.createElement('div');
  popover.className = 'card-menu-popover';
  movable.forEach((button) => popover.append(button));
  menu.append(summary, popover);
  actions.append(menu);
}

function decorateCard(card) {
  if (card.dataset.polished === 'true') return;
  card.dataset.polished = 'true';
  buildCardMenu(card);
  const active = $('.status-button.active', card)?.dataset.status;
  if (active) card.dataset.status = active;
  const priority = $('.priority', card)?.className.match(/priority-(low|normal|high|urgent)/)?.[1];
  if (priority) card.dataset.priority = priority;
}

function renderFriendlyEmptyState(list, text) {
  const trash = text.includes('Papierkorb');
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  wrapper.innerHTML = trash
    ? '<div class="empty-state-icon" aria-hidden="true">♡</div><strong>Hier liegt nichts herum.</strong><span>Der Papierkorb ist leer und alles ist ordentlich.</span>'
    : '<div class="empty-state-icon" aria-hidden="true">⌕</div><strong>Nichts Passendes gefunden.</strong><span>Ändere die Suche oder setze einen Filter zurück.</span>';
  list.replaceChildren(wrapper);
}

function renderSkeletons(list) {
  if (list.dataset.skeleton === 'true') return;
  list.dataset.skeleton = 'true';
  list.replaceChildren(...Array.from({ length: 3 }, () => {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-card';
    skeleton.setAttribute('aria-hidden', 'true');
    return skeleton;
  }));
}

function decorateComplaintList() {
  const list = $('#complaint-list');
  if (!list) return;
  const empty = $('.empty', list);
  if (empty) {
    const text = empty.textContent.trim();
    if (text.includes('geladen')) renderSkeletons(list);
    else if (text.includes('Papierkorb ist leer') || text.includes('passenden Beschwerden')) {
      delete list.dataset.skeleton;
      renderFriendlyEmptyState(list, text);
    } else {
      delete list.dataset.skeleton;
      empty.classList.add('empty-state', 'empty-state-error');
    }
    return;
  }
  delete list.dataset.skeleton;
  $$('.complaint-card', list).forEach(decorateCard);
}

function closeOpenCardMenus(event) {
  $$('.card-menu[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute('open');
  });
}

document.addEventListener('click', closeOpenCardMenus);

const viewObserver = new MutationObserver(syncViews);
$$('#complaint-view, #success-view, #admin-view').forEach((view) => viewObserver.observe(view, { attributes: true, attributeFilter: ['class'] }));

const dashboardObserver = new MutationObserver(() => {
  decorateStats();
  decorateComplaintList();
});
const stats = $('#stats');
const complaintList = $('#complaint-list');
if (stats) dashboardObserver.observe(stats, { childList: true, subtree: true });
if (complaintList) dashboardObserver.observe(complaintList, { childList: true, subtree: true });

const filterPanel = $('#filter-panel');
function syncFilterPanel() {
  if (!filterPanel) return;
  if (innerWidth > 600) filterPanel.open = true;
  else if (!filterPanel.dataset.mobileInitialized) {
    filterPanel.open = false;
    filterPanel.dataset.mobileInitialized = 'true';
  }
}
window.addEventListener('resize', syncFilterPanel, { passive: true });

updateGreeting();
decorateStats();
decorateComplaintList();
syncViews();
syncFilterPanel();
