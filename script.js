/* ═══════════════════════════════════════════════════════
   SERVERHUB – SCRIPT.JS
   Supabase · Discord OAuth · Realtime · Admin Panel
═══════════════════════════════════════════════════════ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ─────────────────────────────────────────────────────
   ⚙️  CONFIG — غيّر هذين فقط
   SUPABASE_ANON_KEY يبدأ بـ eyJ من: Settings → API
───────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';

/*
  🛡️  OWNER IDs
  بعد أول تسجيل دخول، افتح Console وستجد:
  👤 Your UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  انسخه وضعه هنا
*/
const OWNER_IDS = [
  // 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
];

/* ─────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────── */
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let user          = null;
let servers       = [];
let filter        = 'all';
let query         = '';
let deletePending = null;

// Admin state
let adminPending  = [];
let adminActive   = [];
let adminDeleteId = null;
let adminSearch   = '';

/* ─────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const esc = s => !s ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');

const CATS = { gaming:'🎮 ألعاب', programming:'💻 برمجة', anime:'🎌 أنمي', music:'🎵 موسيقى', education:'📚 تعليم', art:'🎨 فن', sports:'⚽ رياضة' };
const COLORS = ['#5865f2','#57f287','#eb459e','#faa61a','#ed4245','#00b0f4','#f47fff','#3ba55c','#e67e22','#9b59b6'];
const hue = name => { let h=0; for(let c of (name||'')) h+=c.charCodeAt(0); return COLORS[h%COLORS.length]; };

function toast(msg, type='info', ms=3500) {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
}

function isOwner() { return user && OWNER_IDS.includes(user.id); }

/* ─────────────────────────────────────────────────────
   DISCORD INVITE URL VALIDATOR
   يقبل جميع أشكال روابط ديسكورد الصحيحة
───────────────────────────────────────────────────── */
function validateAndFixInvite(url) {
  const raw = url.trim();

  // أشكال الروابط المقبولة
  const patterns = [
    /^https?:\/\/discord\.gg\/[a-zA-Z0-9-]+\/?$/,
    /^https?:\/\/discord\.com\/invite\/[a-zA-Z0-9-]+\/?$/,
    /^discord\.gg\/[a-zA-Z0-9-]+\/?$/,
    /^discord\.com\/invite\/[a-zA-Z0-9-]+\/?$/,
  ];

  const valid = patterns.some(p => p.test(raw));
  if (!valid) return null;

  // أضف https:// تلقائياً إذا ناقصة
  if (!raw.startsWith('http')) return 'https://' + raw;
  return raw;
}

/* ─────────────────────────────────────────────────────
   AUTH
───────────────────────────────────────────────────── */
async function login() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) toast('❌ فشل تسجيل الدخول: ' + error.message, 'error');
}

async function logout() {
  await sb.auth.signOut();
  toast('👋 تم تسجيل الخروج', 'info');
}

sb.auth.onAuthStateChange(async (event, session) => {
  user = session?.user ?? null;
  updateAuthUI(event === 'SIGNED_IN');
  if (user) await ensureUserRecord();
  render();
});

function updateAuthUI(welcome=false) {
  if (user) {
    const m = user.user_metadata;
    $('userAvatar').src = m?.avatar_url || '';
    $('userName').textContent = m?.full_name || m?.name || m?.user_name || 'مستخدم';
    $('userInfo').classList.remove('hidden');
    $('btnLogin').classList.add('hidden');
    $('btnAdmin').classList.toggle('hidden', !isOwner());
    console.log('👤 Your UUID:', user.id);
    if (welcome) toast('✅ مرحباً ' + ($('userName').textContent), 'success');
  } else {
    $('userInfo').classList.add('hidden');
    $('btnLogin').classList.remove('hidden');
  }
}

async function ensureUserRecord() {
  const m = user.user_metadata;
  await sb.from('users').upsert({
    id:             user.id,
    discord_name:   m?.full_name || m?.name || m?.user_name || '',
    avatar_url:     m?.avatar_url || '',
    updated_at:     new Date().toISOString(),
  }, { onConflict: 'id' });
}

/* ─────────────────────────────────────────────────────
   FETCH SERVERS
───────────────────────────────────────────────────── */
async function fetchServers() {
  showSkeleton(true);
  const { data, error } = await sb.from('servers').select('*').eq('approved', true).order('created_at', { ascending: false });
  showSkeleton(false);
  if (error) { console.error(error); toast('❌ خطأ في جلب البيانات', 'error'); return; }
  servers = data || [];
  render();
}

function showSkeleton(v) {
  $('skeletonGrid').classList.toggle('hidden', !v);
  if (v) { $('serversGrid').classList.add('hidden'); $('emptyState').classList.add('hidden'); }
}

/* ─────────────────────────────────────────────────────
   RENDER CARDS
───────────────────────────────────────────────────── */
function getVisible() {
  return servers.filter(s => {
    const mc = filter === 'all' || s.category === filter;
    const q2 = query.trim().toLowerCase();
    const ms = !q2 || (s.name||'').toLowerCase().includes(q2) || (s.description||'').toLowerCase().includes(q2);
    return mc && ms;
  });
}

function render() {
  const list = getVisible();
  const grid = $('serversGrid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.classList.add('hidden');
    $('emptyState').classList.remove('hidden');
  } else {
    $('emptyState').classList.add('hidden');
    grid.classList.remove('hidden');
    list.forEach((s, i) => {
      const card = buildCard(s);
      card.style.animationDelay = `${i * 0.04}s`;
      grid.appendChild(card);
    });
  }
  const cat = filter === 'all' ? 'السيرفرات المميزة' : (CATS[filter] || filter);
  $('gridTitle').textContent = cat + (query ? ` · "${query}"` : '') + ` (${list.length})`;
}

function buildCard(s) {
  const isMe    = user?.id === s.owner_id;
  const isAdmin = isOwner();
  const name    = esc(s.name || 'بدون اسم');
  const desc    = esc(s.description || 'لا يوجد وصف.');
  const cat     = CATS[s.category] || s.category || '';
  const invite  = s.invite_url ? esc(s.invite_url) : '#';
  const color   = hue(s.name);
  const letter  = (s.name || '?')[0].toUpperCase();

  const iconHtml = s.icon_url
    ? `<img class="card__icon" src="${esc(s.icon_url)}" alt="${name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
       <div class="card__icon-fb" style="display:none;background:${color}">${letter}</div>`
    : `<div class="card__icon-fb" style="background:${color}">${letter}</div>`;

  const delBtn = (isMe || isAdmin)
    ? `<button class="card__del" data-id="${s.id}">🗑</button>` : '';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card__top">
      <div class="card__icon-wrap">${iconHtml}<span class="online"></span></div>
      <div class="card__info"><div class="card__name">${name}</div><div class="card__cat">${cat}</div></div>
      ${delBtn}
    </div>
    <p class="card__desc">${desc}</p>
    <a class="card__join" href="${invite}" target="_blank" rel="noopener noreferrer">انضم الآن ←</a>`;

  card.querySelector('.card__del')?.addEventListener('click', e => {
    e.stopPropagation();
    deletePending = s.id;
    $('deleteModal').classList.remove('hidden');
  });
  return card;
}

/* ─────────────────────────────────────────────────────
   ADD SERVER
───────────────────────────────────────────────────── */
function openAdd() {
  if (!user) { toast('🔐 سجّل دخولك أولاً', 'error'); return; }
  $('addModal').classList.remove('hidden');
}
function closeAdd() {
  $('addModal').classList.add('hidden');
  ['fName','fDesc','fCat','fInvite','fIcon'].forEach(id => $(id).value = '');
}

async function submitServer() {
  const name   = $('fName').value.trim();
  const desc   = $('fDesc').value.trim();
  const cat    = $('fCat').value;
  const icon   = $('fIcon').value.trim();

  if (!name || !desc || !cat || !$('fInvite').value.trim()) {
    toast('⚠️ أكمل الحقول المطلوبة', 'error'); return;
  }

  // تحقق من الرابط وأصلحه تلقائياً
  const invite = validateAndFixInvite($('fInvite').value);
  if (!invite) {
    toast('⚠️ رابط غير صحيح — مثال: discord.gg/xxxxxxx', 'error'); return;
  }

  const { error } = await sb.from('servers').insert({
    name, description: desc, category: cat,
    invite_url: invite, icon_url: icon || null,
    owner_id: user.id, approved: false
  });
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  toast('✅ تم إرسال السيرفر للمراجعة!', 'success');
  closeAdd();
}

/* ─────────────────────────────────────────────────────
   DELETE SERVER (owner/admin)
───────────────────────────────────────────────────── */
async function deleteServer() {
  if (!deletePending) return;
  let q = sb.from('servers').delete().eq('id', deletePending);
  if (!isOwner()) q = q.eq('owner_id', user.id);
  const { error } = await q;
  $('deleteModal').classList.add('hidden');
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  servers = servers.filter(s => s.id !== deletePending);
  deletePending = null;
  render();
  toast('🗑 تم الحذف', 'info');
}

/* ─────────────────────────────────────────────────────
   REALTIME
───────────────────────────────────────────────────── */
function subscribeRealtime() {
  sb.channel('servers-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'servers' }, ({ eventType, new: nr, old: or }) => {
    if (eventType === 'INSERT' && nr.approved) { servers.unshift(nr); toast('🆕 سيرفر جديد!', 'info'); }
    else if (eventType === 'UPDATE') {
      if (nr.approved) { const i = servers.findIndex(s => s.id === nr.id); i >= 0 ? servers[i] = nr : servers.unshift(nr); }
      else servers = servers.filter(s => s.id !== nr.id);
    }
    else if (eventType === 'DELETE') servers = servers.filter(s => s.id !== or.id);
    render();
  }).subscribe();
}

/* ─────────────────────────────────────────────────────
   ADMIN PANEL
───────────────────────────────────────────────────── */
function openAdmin() {
  if (!isOwner()) { toast('⛔ ليس لديك صلاحية', 'error'); return; }
  $('adminOverlay').classList.remove('hidden');
  loadAdminData();
}
function closeAdmin() { $('adminOverlay').classList.add('hidden'); }

function switchTab(name) {
  document.querySelectorAll('.atab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.anav').forEach(b => b.classList.remove('active'));
  $('tab-' + name).classList.remove('hidden');
  document.querySelector(`.anav[data-tab="${name}"]`).classList.add('active');
}

async function loadAdminData() {
  await Promise.all([loadPending(), loadActive()]);
  updateStats();
}

async function loadPending() {
  const { data } = await sb.from('servers').select('*').eq('approved', false).order('created_at', { ascending: false });
  adminPending = data || [];
  renderPending();
}

async function loadActive() {
  const { data } = await sb.from('servers').select('*').eq('approved', true).order('created_at', { ascending: false });
  adminActive = data || [];
  renderActive();
}

function updateStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayN = [...adminPending, ...adminActive].filter(s => s.created_at?.startsWith(today)).length;
  $('stTotal').textContent   = adminPending.length + adminActive.length;
  $('stPending').textContent = adminPending.length;
  $('stApproved').textContent= adminActive.length;
  $('stToday').textContent   = todayN;
  $('pendingBadge').textContent = adminPending.length;
  $('pendingBadge').style.display = adminPending.length ? 'flex' : 'none';
}

function renderPending() {
  const list = $('pendingList'), empty = $('pendingEmpty');
  list.innerHTML = '';
  if (!adminPending.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  adminPending.forEach(s => list.appendChild(buildAdminRow(s, 'pending')));
}

function renderActive() {
  const list = $('activeList'), empty = $('activeEmpty');
  list.innerHTML = '';
  const q = adminSearch.toLowerCase();
  const filtered = adminActive.filter(s => !q || (s.name||'').toLowerCase().includes(q) || (s.description||'').toLowerCase().includes(q));
  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  filtered.forEach(s => list.appendChild(buildAdminRow(s, 'active')));
}

function buildAdminRow(s, mode) {
  const name   = esc(s.name || 'بدون اسم');
  const color  = hue(s.name);
  const letter = (s.name || '?')[0].toUpperCase();
  const date   = s.created_at ? new Date(s.created_at).toLocaleDateString('ar-EG') : '';
  const cat    = CATS[s.category] || s.category || '';

  const iconHtml = s.icon_url
    ? `<img class="arow__icon" src="${esc(s.icon_url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
       <div class="arow__icon-fb" style="display:none;background:${color}">${letter}</div>`
    : `<div class="arow__icon-fb" style="background:${color}">${letter}</div>`;

  const actions = mode === 'pending'
    ? `<button class="btn--approve" data-id="${s.id}">✅ قبول</button>
       <button class="btn--reject"  data-id="${s.id}">❌ رفض</button>`
    : `<button class="btn--reject"  data-id="${s.id}">🗑 حذف</button>`;

  const row = document.createElement('div');
  row.className = 'arow';
  row.innerHTML = `
    ${iconHtml}
    <div class="arow__info">
      <div class="arow__name">${name}</div>
      <div class="arow__meta"><span class="arow__cat">${cat}</span><span class="arow__date">${date}</span></div>
    </div>
    <div class="arow__actions">${actions}</div>`;

  if (mode === 'pending') {
    row.querySelector('.btn--approve').addEventListener('click', () => approveServer(s.id, s.name));
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(s.id, s.name, 'pending'));
  } else {
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(s.id, s.name, 'active'));
  }
  return row;
}

async function approveServer(id, name) {
  const { error } = await sb.from('servers').update({ approved: true }).eq('id', id);
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  const srv = adminPending.find(s => s.id === id);
  adminPending = adminPending.filter(s => s.id !== id);
  if (srv) adminActive.unshift({ ...srv, approved: true });
  renderPending(); renderActive(); updateStats();
  await fetchServers();
  toast(`✅ تم قبول "${esc(name)}"`, 'success');
}

function openAdminDelete(id, name, mode) {
  adminDeleteId = { id, mode };
  $('adminDeleteMsg').textContent = `هل تريد حذف سيرفر "${name}" نهائياً؟`;
  $('adminDeleteModal').classList.remove('hidden');
}
function closeAdminDelete() { adminDeleteId = null; $('adminDeleteModal').classList.add('hidden'); }

async function confirmAdminDelete() {
  if (!adminDeleteId) return;
  const { id, mode } = adminDeleteId;
  const { error } = await sb.from('servers').delete().eq('id', id);
  closeAdminDelete();
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  if (mode === 'pending') { adminPending = adminPending.filter(s => s.id !== id); renderPending(); }
  else { adminActive = adminActive.filter(s => s.id !== id); servers = servers.filter(s => s.id !== id); renderActive(); render(); }
  updateStats();
  toast('🗑 تم الحذف', 'info');
}

/* ─────────────────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────────────────── */
$('btnLogin').addEventListener('click', login);
$('btnLogout').addEventListener('click', logout);
$('btnAdmin').addEventListener('click', openAdmin);
$('closeAdmin').addEventListener('click', closeAdmin);
$('adminOverlay').addEventListener('click', e => { if (e.target === $('adminOverlay')) closeAdmin(); });

$('btnAdd').addEventListener('click', openAdd);
$('closeAdd').addEventListener('click', closeAdd);
$('cancelAdd').addEventListener('click', closeAdd);
$('submitAdd').addEventListener('click', submitServer);
$('addModal').addEventListener('click', e => { if (e.target === $('addModal')) closeAdd(); });

$('cancelDelete').addEventListener('click', () => $('deleteModal').classList.add('hidden'));
$('confirmDelete').addEventListener('click', deleteServer);
$('deleteModal').addEventListener('click', e => { if (e.target === $('deleteModal')) $('deleteModal').classList.add('hidden'); });

$('adminCancelDelete').addEventListener('click', closeAdminDelete);
$('adminConfirmDelete').addEventListener('click', confirmAdminDelete);
$('adminDeleteModal').addEventListener('click', e => { if (e.target === $('adminDeleteModal')) closeAdminDelete(); });

document.querySelectorAll('.anav').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('refreshPending').addEventListener('click', loadPending);

let adminSearchTimer;
$('adminSearch').addEventListener('input', e => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => { adminSearch = e.target.value; renderActive(); }, 250);
});

let searchTimer;
$('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = e.target.value; render(); }, 250);
});

$('filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filter = btn.dataset.cat;
  render();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeAdd(); closeAdmin(); closeAdminDelete();
  $('deleteModal').classList.add('hidden');
});

/* ─────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────── */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  updateAuthUI(false);
  if (user) await ensureUserRecord();
  await fetchServers();
  subscribeRealtime();
})();
