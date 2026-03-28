/* ═══════════════════════════════════════════════════════════════
   DISCBOARD – SCRIPT.JS
   ES6 Modules · Supabase BaaS · Discord OAuth · Realtime
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ───────────────────────────────────────────────────────────────
   1. CONFIG  ← ضع بياناتك هنا
─────────────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';  // ← غيّر هذا
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';                  // ← غيّر هذا

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    showToast('✅ مرحباً ' + name, 'success');
  } else {
    userProfile.classList.add('hidden');
    btnLogin.classList.remove('hidden');
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
