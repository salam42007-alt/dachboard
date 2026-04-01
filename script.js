/* ═══════════════════════════════════════════════════════════════
   DISCBOARD – SCRIPT.JS
   ES6 Modules · Supabase BaaS · Discord OAuth · Realtime
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ───────────────────────────────────────────────────────────────
   1. CONFIG  ← ضع بياناتك هنا
─────────────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://voagykakapoxiycbaxbm.supabase.co';  // ← غيّر هذا
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvYWd5a2FrYXBveGl5Y2JheGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDQ3MjQsImV4cCI6MjA5MDI4MDcyNH0.MuAYGdHy5aQb2xLHsnb2NrP5P5QNUtPR9IPUgdUclJM';                  // ← غيّر هذا

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 
/**
 * 🛡️ ADMIN WHITELIST
 * كيف تحصل على UUID الخاص بك:
 *   1. سجّل دخولك
 *   2. افتح Console (F12)
 *   3. ستجد: 🔑 Your Supabase UUID: xxxx-xxxx-...
 *   4. انسخه وضعه هنا
 */
const ADMIN_IDS = [
  'YOUR_SUPABASE_UUID_HERE', // ← UUID من Supabase (مش Discord ID)
];
 
/* ───────────────────────────────────────────────────────────────
   2. STATE
─────────────────────────────────────────────────────────────── */
let currentUser   = null;
let allServers    = [];
let activeFilter  = 'all';
let searchQuery   = '';
let pendingDelete = null;
 
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
   🔧 FIX: showToast فقط عند SIGNED_IN الجديد مش عند كل تحميل
─────────────────────────────────────────────────────────────── */
async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      // 🔴 تأكد في Supabase Dashboard → Authentication → URL Configuration
      // أضف هذا الرابط في "Redirect URLs"
    }
  });
  if (error) showToast('❌ فشل تسجيل الدخول: ' + error.message, 'error');
}
 
async function signOut() {
  await supabase.auth.signOut();
  showToast('👋 تم تسجيل الخروج', 'info');
}
 
// 🔧 FIX: showWelcome parameter لتجنب Toast عند كل refresh
supabase.auth.onAuthStateChange((event, session) => {
  currentUser = session?.user ?? null;
  updateAuthUI(event === 'SIGNED_IN');
  renderVisible();
});
 
function updateAuthUI(showWelcome = false) {
  const adminBtn = $('btnAdminPanel');
 
  if (currentUser) {
    const meta   = currentUser.user_metadata;
    const avatar = meta?.avatar_url || '';
    const name   = meta?.full_name || meta?.name || meta?.user_name || 'مستخدم';
 
    userAvatar.src = avatar;
    userName.textContent = name;
    userProfile.classList.remove('hidden');
    btnLogin.classList.add('hidden');
 
    // 🔧 FIX: طباعة UUID الصحيح في Console لسهولة الإعداد
    console.log('🔑 Your Supabase UUID:', currentUser.id);
    console.log('📋 Discord Username:', meta?.full_name || meta?.name);
 
    // 🔧 FIX: المقارنة بـ currentUser.id (Supabase UUID) وهو صحيح
    if (ADMIN_IDS.includes(currentUser.id)) {
      adminBtn.style.display = 'inline-flex';
    } else {
      adminBtn.style.display = 'none';
    }
 
    if (showWelcome) showToast('✅ مرحباً ' + name, 'success');
 
  } else {
    userProfile.classList.add('hidden');
    btnLogin.classList.remove('hidden');
    adminBtn.style.display = 'none';
  }
}
 
/* ───────────────────────────────────────────────────────────────
   6. DATA FETCHING
   🔧 FIX: إضافة تشخيص واضح لأسباب عدم ظهور السيرفرات
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
    // 🔧 FIX: رسالة خطأ تفصيلية تساعد في التشخيص
    console.error('❌ Supabase fetch error:', error);
 
    if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
      showToast('❌ خطأ في الـ API Key — تحقق من SUPABASE_ANON_KEY', 'error');
    } else if (error.code === '42501' || error.message?.includes('RLS')) {
      showToast('❌ خطأ في صلاحيات قاعدة البيانات (RLS) — راجع التعليمات أدناه', 'error');
      console.warn(`
🔴 RLS FIX NEEDED — شغّل هذا في Supabase SQL Editor:
-- السماح للجميع بقراءة السيرفرات المقبولة
CREATE POLICY "public read approved servers"
ON servers FOR SELECT
USING (approved = true);
 
-- السماح للمسجلين بإضافة سيرفرات
CREATE POLICY "auth users can insert"
ON servers FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);
 
-- السماح للمالك بحذف سيرفره
CREATE POLICY "owner can delete"
ON servers FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);
      `);
    } else {
      showToast('❌ حدث خطأ في جلب البيانات: ' + error.message, 'error');
    }
    return;
  }
 
  console.log(`✅ Fetched ${data?.length || 0} approved servers`);
  allServers = data || [];
  renderVisible();
}
 
/* ───────────────────────────────────────────────────────────────
   7. FILTER & SEARCH (client-side)
─────────────────────────────────────────────────────────────── */
function getVisible() {
  return allServers.filter(s => {
    const matchCat    = activeFilter === 'all' || s.category === activeFilter;
    const q           = searchQuery.trim().toLowerCase();
    const matchSearch = !q ||
      (s.name        || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });
}
 
/* ───────────────────────────────────────────────────────────────
   8. BUILD CARDS
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
 
  const iconHtml = server.icon_url
    ? `<img class="card__icon" src="${escHtml(server.icon_url)}" alt="${name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="card__icon-fallback" style="display:none;background:${color}">${letter}</div>`
    : `<div class="card__icon-fallback" style="background:${color}">${letter}</div>`;
 
  // 🔧 FIX: Admin يشوف زر الحذف أيضاً
  const isAdmin  = ADMIN_IDS.includes(currentUser?.id);
  const deleteBtn = (isOwner || isAdmin)
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
 
  const catLabel = activeFilter === 'all'
    ? 'السيرفرات المميزة'
    : (CAT_LABELS[activeFilter] || activeFilter);
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
  // 🔧 FIX: إزالة المسافة الزائدة في $( id)
  ['formName','formDesc','formCat','formInvite','formIcon'].forEach(id => $(id).value = '');
}
 
async function submitServer() {
  const name   = $('formName').value.trim();
  const desc   = $('formDesc').value.trim();
  const cat    = $('formCat').value;
  const invite = $('formInvite').value.trim();
  const icon   = $('formIcon').value.trim();
 
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
    category:    cat,
    invite_url:  invite,
    icon_url:    icon || null,
    owner_id:    currentUser.id,
    approved:    false,
  });
 
  if (error) {
    console.error('Insert error:', error);
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
 
  const isAdmin = ADMIN_IDS.includes(currentUser?.id);
 
  let query = supabase.from('servers').delete().eq('id', pendingDelete);
 
  // 🔧 FIX: Admin يحذف أي سيرفر، المالك فقط سيرفره
  if (!isAdmin) {
    query = query.eq('owner_id', currentUser.id);
  }
 
  const { error } = await query;
 
  closeDeleteModal();
 
  if (error) {
    showToast('❌ فشل الحذف: ' + error.message, 'error');
    return;
  }
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
   13. REALTIME
   🔧 FIX: إزالة filter غير المدعوم — الفلترة تصير بالكود
─────────────────────────────────────────────────────────────── */
function subscribeRealtime() {
  supabase
    .channel('public:servers')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'servers' }, // ← أزلنا filter هنا
      payload => {
        const { eventType, new: newRow, old: oldRow } = payload;
 
        if (eventType === 'INSERT') {
          // 🔧 FIX: فقط السيرفرات المقبولة تظهر في الـ grid
          if (newRow.approved) {
            allServers.unshift(newRow);
            showToast('🆕 سيرفر جديد تمت إضافته!', 'info');
          }
        } else if (eventType === 'UPDATE') {
          if (newRow.approved) {
            const exists = allServers.find(s => s.id === newRow.id);
            if (exists) {
              allServers = allServers.map(s => s.id === newRow.id ? newRow : s);
            } else {
              // سيرفر تمت الموافقة عليه الآن
              allServers.unshift(newRow);
              showToast('🆕 سيرفر جديد تمت الموافقة عليه!', 'info');
            }
          } else {
            // سيرفر تم رفضه — أزله من القائمة
            allServers = allServers.filter(s => s.id !== newRow.id);
          }
        } else if (eventType === 'DELETE') {
          allServers = allServers.filter(s => s.id !== oldRow.id);
        }
 
        renderVisible();
      }
    )
    .subscribe(status => {
      console.log('🔌 Realtime status:', status);
    });
}
 
/* ───────────────────────────────────────────────────────────────
   14. EVENT LISTENERS
─────────────────────────────────────────────────────────────── */
btnLogin.addEventListener('click', signIn);
btnLogout.addEventListener('click', signOut);
 
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value;
    renderVisible();
  }, 250);
});
 
filtersEl.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.cat;
  renderVisible();
});
 
btnAddServer.addEventListener('click', openAddModal);
$('closeAddModal').addEventListener('click', closeAddModal);
$('cancelAdd').addEventListener('click', closeAddModal);
$('submitAdd').addEventListener('click', submitServer);
addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });
 
$('cancelDelete').addEventListener('click', closeDeleteModal);
$('confirmDelete').addEventListener('click', deleteServer);
deleteModal.addEventListener('click', e => { if (e.target === deleteModal) closeDeleteModal(); });
 
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeAddModal(); closeDeleteModal(); }
});
 
/* ───────────────────────────────────────────────────────────────
   15. INIT
─────────────────────────────────────────────────────────────── */
(async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  updateAuthUI(false); // false = لا تعرض Toast عند أول تحميل
 
  await fetchServers();
  subscribeRealtime();
})();
 
/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL MODULE
═══════════════════════════════════════════════════════════════ */
 
let adminPending  = [];
let adminActive   = [];
let adminDeleteId = null;
let adminSearchQ  = '';
 
const adminOverlay    = $('adminOverlay');
const adminDeleteModal= $('adminDeleteModal');
const adminDeleteMsg  = $('adminDeleteMsg');
const navBadgePending = $('navBadgePending');
 
function openAdminPanel() {
  // 🔧 FIX: تحقق من الصلاحيات قبل فتح اللوحة
  if (!currentUser) {
    showToast('🔐 يجب تسجيل الدخول أولاً', 'error');
    return;
  }
  if (!ADMIN_IDS.includes(currentUser.id)) {
    showToast('⛔ ليس لديك صلاحية الوصول للوحة التحكم', 'error');
    console.warn('Unauthorized access attempt. Your UUID:', currentUser.id);
    return;
  }
  adminOverlay.classList.remove('hidden');
  loadAdminData();
}
 
function closeAdminPanel() {
  adminOverlay.classList.add('hidden');
}
 
function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
  $('tab-' + tabName).classList.remove('hidden');
  document.querySelector(`.admin-nav-btn[data-tab="${tabName}"]`).classList.add('active');
}
 
async function loadAdminData() {
  await Promise.all([loadAdminPending(), loadAdminActive()]);
  updateAdminStats();
}
 
async function loadAdminPending() {
  const { data, error } = await supabase
    .from('servers').select('*')
    .eq('approved', false)
    .order('created_at', { ascending: false });
 
  if (error) {
    console.error('Admin pending error:', error);
    showToast('❌ خطأ في جلب الطلبات — تحقق من RLS policies', 'error');
    return;
  }
  adminPending = data || [];
  renderAdminPending();
}
 
async function loadAdminActive() {
  const { data, error } = await supabase
    .from('servers').select('*')
    .eq('approved', true)
    .order('created_at', { ascending: false });
 
  if (error) {
    console.error('Admin active error:', error);
    showToast('❌ خطأ في جلب السيرفرات', 'error');
    return;
  }
  adminActive = data || [];
  renderAdminActive();
}
 
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
 
function renderAdminActive() {
  const list  = $('activeList');
  const empty = $('activeEmpty');
  list.innerHTML = '';
  const filtered = adminActive.filter(s => {
    const q = adminSearchQ.toLowerCase();
    return !q ||
      (s.name        || '').toLowerCase().includes(q) ||
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
 
  if (mode === 'pending') {
    row.querySelector('.btn--approve').addEventListener('click', () => approveServer(server.id, name));
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(server.id, name, 'pending'));
  } else {
    row.querySelector('.btn--reject').addEventListener('click',  () => openAdminDelete(server.id, name, 'active'));
  }
 
  return row;
}
 
async function approveServer(id, name) {
  const { error } = await supabase
    .from('servers').update({ approved: true }).eq('id', id);
 
  if (error) {
    console.error('Approve error:', error);
    showToast('❌ فشل القبول: ' + error.message, 'error');
    return;
  }
  showToast(`✅ تم قبول سيرفر "${name}" بنجاح`, 'success');
  const srv = adminPending.find(s => s.id === id);
  adminPending = adminPending.filter(s => s.id !== id);
  if (srv) adminActive.unshift({ ...srv, approved: true });
  renderAdminPending();
  renderAdminActive();
  updateAdminStats();
  await fetchServers();
}
 
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
 
  if (error) {
    console.error('Admin delete error:', error);
    showToast('❌ فشل الحذف: ' + error.message, 'error');
    return;
  }
 
  if (mode === 'pending') {
    adminPending = adminPending.filter(s => s.id !== id);
    showToast('🗑️ تم رفض وحذف السيرفر', 'info');
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
 
document.querySelectorAll('.admin-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
});
 
$('refreshPending').addEventListener('click', loadAdminPending);
 
let adminSearchTimer;
$('adminSearch').addEventListener('input', e => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => {
    adminSearchQ = e.target.value;
    renderAdminActive();
  }, 250);
});
 
$('adminCancelDelete').addEventListener('click', closeAdminDelete);
$('adminConfirmDelete').addEventListener('click', confirmAdminDelete);
adminDeleteModal.addEventListener('click', e => {
  if (e.target === adminDeleteModal) closeAdminDelete();
});
 
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAdminPanel();
    closeAdminDelete();
  }
});
