/* ═══════════════════════════════════════════════════════════════
   DISCBOARD – SCRIPT.JS
   ES6 Modules · Supabase BaaS · Discord OAuth · Realtime
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ───────────────────────────────────────────────────────────────
   1. CONFIG  ← ضع بياناتك هنا
─────────────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://voagykakapoxiycbaxbm.supabase.co';  // ← غيّر هذا
const SUPABASE_ANON_KEY = 'sb_publishable_Q6hATwZZS6C6_vCKyIRIkQ_VXhWQy8M';                  // ← غيّر هذا

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 🛡️ ADMIN WHITELIST — ضع Discord User ID الخاص بك هنا
 * كيف تعرف الـ ID؟ سجّل دخولك مرة واحدة ثم افتح Console وستجده مطبوعاً
 */
const ADMIN_IDS = [
  '556881765428363279',  // ← استبدل هذا بـ ID الديسكورد الخاص بك
];

/* ───────────────────────────────────────────────────────────────
   2. STATE
─────────────────────────────────────────────────────────────── */
let currentUser   = null;
let allServers    = [];          // كل السيرفرات المجلوبة
let activeFilter  = 'all';
let searchQuery   = '';
let pendingDelete = null;        // ID السيرفر المراد حذفه

/* ───────────────────────────────────────────────────────────────
   3. DOM REFS
─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const btnLogin      = $('btnLogin');
const btnLogout     = $('btnLogout');
const userProfile   = $('userProfile');
const userAvatar    = $('userAvatar');
const userName      = $('userName');
const searchInput   = $('searchInput');
const filtersEl     = $('filters');
const serversGrid   = $('serversGrid');
const skeletonGrid  = $('skeletonGrid');
const emptyState    = $('emptyState');
const gridTitle     = $('gridTitle');
const btnAddServer  = $('btnAddServer');
const addModal      = $('addModal');
const deleteModal   = $('deleteModal');
const toastContainer= $('toastContainer');

/* ───────────────────────────────────────────────────────────────
   4. SECURITY – XSS Protection
─────────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/* ───────────────────────────────────────────────────────────────
   5. AUTH MANAGEMENT
─────────────────────────────────────────────────────────────── */

// تسجيل الدخول بديسكورد
async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.href }
  });
  if (error) showToast('❌ فشل تسجيل الدخول: ' + error.message, 'error');
}

// تسجيل الخروج
async function signOut() {
  await supabase.auth.signOut();
  showToast('👋 تم تسجيل الخروج', 'info');
}

// مراقبة حالة المستخدم – تعمل فوراً عند أي تغيير
supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  updateAuthUI();
  renderVisible();   // أعد رسم الكروت لإظهار/إخفاء زر الحذف
});

function updateAuthUI() {
  if (currentUser) {
    const meta   = currentUser.user_metadata;
    const avatar = meta?.avatar_url || '';
    const name   = meta?.full_name || meta?.name || 'مستخدم';

    userAvatar.src = avatar;
    userName.textContent = name;
    userProfile.classList.remove('hidden');
    btnLogin.classList.add('hidden');

    // Show admin button only for owners
    const adminBtn = $('btnAdminPanel');
    if (ADMIN_IDS.includes(currentUser.id)) {
      adminBtn.style.display = 'inline-flex';
    } else {
      adminBtn.style.display = 'none';
    }
    showToast('✅ مرحباً ' + name, 'success');
  } else {
    userProfile.classList.add('hidden');
    btnLogin.classList.remove('hidden');
    $('btnAdminPanel').style.display = 'none';
  }
}

/* ───────────────────────────────────────────────────────────────
   6. DATA FETCHING
─────────────────────────────────────────────────────────────── */
async function fetchServers() {
  showSkeleton(true);

  const { data, error } = await supabase
    .from('servers')
    .select('*')
    .eq('approved', true)
    .order('created_at', { ascending: false });

  showSkeleton(false);

  if (error) {
    showToast('❌ حدث خطأ في جلب البيانات', 'error');
    console.error(error);
    return;
  }

  allServers = data || [];
  renderVisible();
}

/* ───────────────────────────────────────────────────────────────
   7. FILTER & SEARCH (client-side)
─────────────────────────────────────────────────────────────── */
function getVisible() {
  return allServers.filter(s => {
    const matchCat  = activeFilter === 'all' || s.category === activeFilter;
    const q         = searchQuery.trim().toLowerCase();
    const matchSearch = !q ||
      (s.name  || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });
}

/* ───────────────────────────────────────────────────────────────
   8. BUILD CARDS (DOM Manipulation)
─────────────────────────────────────────────────────────────── */
const CAT_LABELS = {
  gaming:      '🎮 ألعاب',
  programming: '💻 برمجة',
  anime:       '🎌 أنمي',
  music:       '🎵 موسيقى',
  education:   '📚 تعليم',
  art:         '🎨 فن',
  sports:      '⚽ رياضة',
};

// ألوان الأيقونة الاحتياطية بناءً على أول حرف
const PALETTE = [
  '#5865f2','#57f287','#eb459e','#faa61a','#ed4245',
  '#00b0f4','#f47fff','#3ba55c','#e67e22','#9b59b6'
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h += name.charCodeAt(i);
  return PALETTE[h % PALETTE.length];
}

function buildCard(server) {
  const isOwner = currentUser && currentUser.id === server.owner_id;
  const name    = escHtml(server.name || 'بدون اسم');
  const desc    = escHtml(server.description || 'لا يوجد وصف.');
  const cat     = CAT_LABELS[server.category] || server.category || '';
  const invite  = server.invite_url ? escHtml(server.invite_url) : '#';
  const color   = avatarColor(server.name);
  const letter  = (server.name || '?')[0].toUpperCase();

  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = server.id;

  // Construct icon HTML
  const iconHtml = server.icon_url
    ? `<img class="card__icon" src="${escHtml(server.icon_url)}" alt="${name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="card__icon-fallback" style="display:none;background:${color}">${letter}</div>`
    : `<div class="card__icon-fallback" style="background:${color}">${letter}</div>`;

  const deleteBtn = isOwner
    ? `<button class="card__delete" data-id="${server.id}" title="حذف السيرفر">🗑️</button>`
    : '';

  card.innerHTML = `
    <div class="card__top">
      <div class="card__icon-wrap">
        ${iconHtml}
        <span class="online-dot"></span>
      </div>
      <div class="card__info">
        <div class="card__name">${name}</div>
        <div class="card__cat">${cat}</div>
      </div>
      ${deleteBtn}
    </div>
    <p class="card__desc">${desc}</p>
    <a class="card__join" href="${invite}" target="_blank" rel="noopener noreferrer">
      انضم الآن ←
    </a>
  `;

  // Delete event
  const delBtn = card.querySelector('.card__delete');
  if (delBtn) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      openDeleteModal(server.id);
    });
  }

  return card;
}

function renderVisible() {
  const visible = getVisible();
  serversGrid.innerHTML = '';

  if (visible.length === 0) {
    serversGrid.classList.add('hidden');
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    serversGrid.classList.remove('hidden');
    visible.forEach((s, i) => {
      const card = buildCard(s);
      card.style.animationDelay = `${i * 0.05}s`;
      serversGrid.appendChild(card);
    });
  }

  // Update title
  const catLabel = activeFilter === 'all' ? 'السيرفرات المميزة' : (CAT_LABELS[activeFilter] || activeFilter);
  gridTitle.textContent = catLabel + (searchQuery ? ` · "${searchQuery}"` : '') + ` (${visible.length})`;
}

/* ───────────────────────────────────────────────────────────────
   9. SKELETON LOADER
─────────────────────────────────────────────────────────────── */
function showSkeleton(show) {
  if (show) {
    skeletonGrid.classList.remove('hidden');
    serversGrid.classList.add('hidden');
    emptyState.classList.add('hidden');
  } else {
    skeletonGrid.classList.add('hidden');
  }
}

/* ───────────────────────────────────────────────────────────────
   10. ADD SERVER
─────────────────────────────────────────────────────────────── */
function openAddModal() {
  if (!currentUser) {
    showToast('🔐 يجب تسجيل الدخول أولاً لإضافة سيرفر', 'error');
    return;
  }
  addModal.classList.remove('hidden');
}
function closeAddModal() {
  addModal.classList.add('hidden');
  // Reset form
  ['formName','formDesc','formCat','formInvite','formIcon'].forEach(id => $( id).value = '');
}

async function submitServer() {
  const name    = $('formName').value.trim();
  const desc    = $('formDesc').value.trim();
  const cat     = $('formCat').value;
  const invite  = $('formInvite').value.trim();
  const icon    = $('formIcon').value.trim();

  if (!name || !desc || !cat || !invite) {
    showToast('⚠️ يرجى ملء جميع الحقول المطلوبة', 'error');
    return;
  }
  if (!invite.startsWith('https://discord.gg/') && !invite.startsWith('https://discord.com/invite/')) {
    showToast('⚠️ رابط الدعوة يجب أن يبدأ بـ https://discord.gg/', 'error');
    return;
  }

  const { error } = await supabase.from('servers').insert({
    name,
    description: desc,
    category: cat,
    invite_url: invite,
    icon_url:   icon || null,
    owner_id:   currentUser.id,
    approved:   false,
  });

  if (error) {
    showToast('❌ فشل إضافة السيرفر: ' + error.message, 'error');
    return;
  }
  showToast('✅ تم إرسال السيرفر للمراجعة بنجاح!', 'success');
  closeAddModal();
}

/* ───────────────────────────────────────────────────────────────
   11. DELETE SERVER
─────────────────────────────────────────────────────────────── */
function openDeleteModal(serverId) {
  pendingDelete = serverId;
  deleteModal.classList.remove('hidden');
}
function closeDeleteModal() {
  pendingDelete = null;
  deleteModal.classList.add('hidden');
}

async function deleteServer() {
  if (!pendingDelete) return;

  const { error } = await supabase
    .from('servers')
    .delete()
    .eq('id', pendingDelete)
    .eq('owner_id', currentUser.id);  // حماية: فقط المالك يحذف

  closeDeleteModal();

  if (error) {
    showToast('❌ فشل الحذف: ' + error.message, 'error');
    return;
  }
  // Remove locally
  allServers = allServers.filter(s => s.id !== pendingDelete);
  renderVisible();
  showToast('🗑️ تم حذف السيرفر بنجاح', 'info');
}

/* ───────────────────────────────────────────────────────────────
   12. TOAST SYSTEM
─────────────────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

/* ───────────────────────────────────────────────────────────────
   13. REALTIME – Live Updates
─────────────────────────────────────────────────────────────── */
function subscribeRealtime() {
  supabase
    .channel('public:servers')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'servers', filter: 'approved=eq.true' },
      payload => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT') {
          allServers.unshift(newRow);
          showToast('🆕 سيرفر جديد تمت إضافته!', 'info');
        } else if (eventType === 'UPDATE') {
          allServers = allServers.map(s => s.id === newRow.id ? newRow : s);
        } else if (eventType === 'DELETE') {
          allServers = allServers.filter(s => s.id !== oldRow.id);
        }
        renderVisible();
      }
    )
    .subscribe();
}

/* ───────────────────────────────────────────────────────────────
   14. EVENT LISTENERS
─────────────────────────────────────────────────────────────── */

// Auth
btnLogin.addEventListener('click', signIn);
btnLogout.addEventListener('click', signOut);

// Search (debounced 250ms)
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value;
    renderVisible();
  }, 250);
});

// Filter tabs
filtersEl.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.cat;
  renderVisible();
});

// Add modal
btnAddServer.addEventListener('click', openAddModal);
$('closeAddModal').addEventListener('click', closeAddModal);
$('cancelAdd').addEventListener('click', closeAddModal);
$('submitAdd').addEventListener('click', submitServer);
addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });

// Delete modal
$('cancelDelete').addEventListener('click', closeDeleteModal);
$('confirmDelete').addEventListener('click', deleteServer);
deleteModal.addEventListener('click', e => { if (e.target === deleteModal) closeDeleteModal(); });

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeAddModal(); closeDeleteModal(); }
});

/* ───────────────────────────────────────────────────────────────
   15. INIT
─────────────────────────────────────────────────────────────── */
(async function init() {
  // Check existing session
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  updateAuthUI();

  // Load servers
  await fetchServers();

  // Subscribe to real-time updates
  subscribeRealtime();
})();

/* ═══════════════════════════════════════════════════════════════
   ██████████  ADMIN PANEL MODULE  ██████████
   مدمج داخل script.js – يعمل فقط للأونر
═══════════════════════════════════════════════════════════════ */

/* ── Admin State ── */
let adminPending  = [];
let adminActive   = [];
let adminDeleteId = null;
let adminSearchQ  = '';

/* ── Admin DOM ── */
const adminOverlay    = $('adminOverlay');
const adminDeleteModal= $('adminDeleteModal');
const adminDeleteMsg  = $('adminDeleteMsg');
const navBadgePending = $('navBadgePending');

/* ── Open / Close Panel ── */
function openAdminPanel() {
  adminOverlay.classList.remove('hidden');
  loadAdminData();
}
function closeAdminPanel() {
  adminOverlay.classList.add('hidden');
}

/* ── Tab switching ── */
function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
  $('tab-' + tabName).classList.remove('hidden');
  document.querySelector(`.admin-nav-btn[data-tab="${tabName}"]`).classList.add('active');
}

/* ── Load all admin data ── */
async function loadAdminData() {
  await Promise.all([loadAdminPending(), loadAdminActive()]);
  updateAdminStats();
}

async function loadAdminPending() {
  const { data, error } = await supabase
    .from('servers').select('*')
    .eq('approved', false)
    .order('created_at', { ascending: false });
  if (error) { showToast('❌ خطأ في جلب الطلبات', 'error'); return; }
  adminPending = data || [];
  renderAdminPending();
}

async function loadAdminActive() {
  const { data, error } = await supabase
    .from('servers').select('*')
    .eq('approved', true)
    .order('created_at', { ascending: false });
  if (error) { showToast('❌ خطأ في جلب السيرفرات', 'error'); return; }
  adminActive = data || [];
  renderAdminActive();
}

/* ── Stats ── */
function updateAdminStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayCount = [...adminPending, ...adminActive]
    .filter(s => s.created_at?.startsWith(today)).length;

  animateAdminCount($('stTotal'),    adminPending.length + adminActive.length);
  animateAdminCount($('stPending'),  adminPending.length);
  animateAdminCount($('stApproved'), adminActive.length);
  animateAdminCount($('stToday'),    todayCount);

  navBadgePending.textContent = adminPending.length;
  navBadgePending.style.display = adminPending.length === 0 ? 'none' : 'flex';
}

function animateAdminCount(el, target) {
  if (!el) return;
  let cur = 0;
  const step = Math.max(1, Math.ceil(target / 20));
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = cur;
    if (cur >= target) clearInterval(t);
  }, 40);
}

/* ── Render Pending ── */
function renderAdminPending() {
  const list  = $('pendingList');
  const empty = $('pendingEmpty');
  list.innerHTML = '';
  if (adminPending.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  adminPending.forEach((s, i) => {
    const row = buildAdminRow(s, 'pending');
    row.style.animationDelay = `${i * 0.04}s`;
    list.appendChild(row);
  });
}

/* ── Render Active ── */
function renderAdminActive() {
  const list  = $('activeList');
  const empty = $('activeEmpty');
  list.innerHTML = '';
  const filtered = adminActive.filter(s => {
    const q = adminSearchQ.toLowerCase();
    return !q ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q);
  });
  if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  filtered.forEach((s, i) => {
    const row = buildAdminRow(s, 'active');
    row.style.animationDelay = `${i * 0.04}s`;
    list.appendChild(row);
  });
}

/* ── Build Admin Row ── */
const PALETTE_A = ['#5865f2','#57f287','#eb459e','#faa61a','#ed4245','#00b0f4','#3ba55c','#f47fff'];
function adminAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h += name.charCodeAt(i);
  return PALETTE_A[h % PALETTE_A.length];
}

function buildAdminRow(server, mode) {
  const name   = escHtml(server.name || 'بدون اسم');
  const desc   = escHtml(server.description || '–');
  const cat    = CAT_LABELS[server.category] || server.category || '';
  const color  = adminAvatarColor(server.name);
  const letter = (server.name || '?')[0].toUpperCase();
  const date   = server.created_at ? new Date(server.created_at).toLocaleDateString('ar-EG') : '';

  const iconHtml = server.icon_url
    ? `<img class="admin-row__icon" src="${escHtml(server.icon_url)}" alt="${name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="admin-row__icon-fb" style="display:none;background:${color}">${letter}</div>`
    : `<div class="admin-row__icon-fb" style="background:${color}">${letter}</div>`;

  const actions = mode === 'pending'
    ? `<button class="btn--approve" data-id="${server.id}">✅ قبول</button>
       <button class="btn--reject"  data-id="${server.id}">❌ رفض</button>`
    : `<button class="btn--reject"  data-id="${server.id}" data-name="${name}">🗑️ حذف</button>`;

  const row = document.createElement('div');
  row.className = 'admin-row';
  row.innerHTML = `
    ${iconHtml}
    <div class="admin-row__info">
      <div class="admin-row__name">${name}</div>
      <div class="admin-row__meta">
        <span class="admin-row__cat">${cat}</span>
        <span class="admin-row__date">${date}</span>
      </div>
      <div class="admin-row__desc">${desc}</div>
    </div>
    <div class="admin-row__actions">${actions}</div>
  `;

  // Wire buttons
  if (mode === 'pending') {
    row.querySelector('.btn--approve').addEventListener('click', () => approveServer(server.id, name));
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(server.id, name, 'pending'));
  } else {
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(server.id, name, 'active'));
  }

  return row;
}

/* ── Approve ── */
async function approveServer(id, name) {
  const { error } = await supabase
    .from('servers').update({ approved: true }).eq('id', id);
  if (error) { showToast('❌ فشل القبول: ' + error.message, 'error'); return; }
  showToast(`✅ تم قبول سيرفر "${name}" بنجاح`, 'success');
  // Move from pending to active locally
  const srv = adminPending.find(s => s.id === id);
  adminPending = adminPending.filter(s => s.id !== id);
  if (srv) adminActive.unshift({ ...srv, approved: true });
  renderAdminPending();
  renderAdminActive();
  updateAdminStats();
  // Refresh main grid too
  await fetchServers();
}

/* ── Admin Delete ── */
function openAdminDelete(id, name, mode) {
  adminDeleteId = { id, mode };
  adminDeleteMsg.textContent = `هل تريد حذف سيرفر "${name}" نهائياً؟ لا يمكن التراجع.`;
  adminDeleteModal.classList.remove('hidden');
}
function closeAdminDelete() {
  adminDeleteId = null;
  adminDeleteModal.classList.add('hidden');
}

async function confirmAdminDelete() {
  if (!adminDeleteId) return;
  const { id, mode } = adminDeleteId;

  const { error } = await supabase.from('servers').delete().eq('id', id);
  closeAdminDelete();
  if (error) { showToast('❌ فشل الحذف: ' + error.message, 'error'); return; }

  if (mode === 'pending') {
    const srv = adminPending.find(s => s.id === id);
    adminPending = adminPending.filter(s => s.id !== id);
    showToast(`🗑️ تم رفض وحذف السيرفر`, 'info');
    renderAdminPending();
  } else {
    adminActive = adminActive.filter(s => s.id !== id);
    allServers  = allServers.filter(s => s.id !== id);
    showToast('🗑️ تم حذف السيرفر من القائمة النشطة', 'info');
    renderAdminActive();
    renderVisible();
  }
  updateAdminStats();
}

/* ── Admin Event Listeners ── */
$('btnAdminPanel').addEventListener('click', openAdminPanel);
$('closeAdmin').addEventListener('click', closeAdminPanel);
adminOverlay.addEventListener('click', e => { if (e.target === adminOverlay) closeAdminPanel(); });

// Tab nav
document.querySelectorAll('.admin-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
});

// Refresh pending
$('refreshPending').addEventListener('click', loadAdminPending);

// Admin search (active servers)
let adminSearchTimer;
$('adminSearch').addEventListener('input', e => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => {
    adminSearchQ = e.target.value;
    renderAdminActive();
  }, 250);
});

// Admin delete modal
$('adminCancelDelete').addEventListener('click', closeAdminDelete);
$('adminConfirmDelete').addEventListener('click', confirmAdminDelete);
adminDeleteModal.addEventListener('click', e => {
  if (e.target === adminDeleteModal) closeAdminDelete();
});

// ESC closes admin too
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAdminPanel();
    closeAdminDelete();
  }
});

// Print user ID to console for easy setup
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) console.log('🔑 Your Discord User ID:', session.user.id);
});
