/* ── Pitho.ai CRM — crm.js (Supabase + Auth) ── */

const SUPABASE_URL = 'https://yijdhsjmqblcftcwlmbw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpamRoc2ptcWJsY2Z0Y3dsbWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxNDEwNjUsImV4cCI6MjA4NTcxNzA2NX0.Z_e3XzaVA1iT2ulilSPUa-9U91DaRAbtZeamNu-_XPk';

let authToken = null; // JWT from logged-in user
let currentUser = null;

// ── Auth: check session and refresh if needed ──
async function checkAuth() {
  const result = await chrome.storage.local.get('pitho_session');
  const session = result.pitho_session;

  if (!session || !session.access_token) {
    redirectToLogin();
    return false;
  }

  // Check if token expired — try to refresh
  if (session.expires_at < Date.now()) {
    try {
      const refreshed = await refreshToken(session.refresh_token);
      authToken = refreshed.access_token;
      currentUser = refreshed.user;
      return true;
    } catch (err) {
      console.error('[CRM] Token refresh failed:', err);
      redirectToLogin();
      return false;
    }
  }

  authToken = session.access_token;
  currentUser = session.user;
  return true;
}

async function refreshToken(refresh_token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token }),
  });
  if (!resp.ok) throw new Error('Refresh failed');
  const data = await resp.json();

  // Update stored session
  const newSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.email.split('@')[0],
    },
  };
  await chrome.storage.local.set({ pitho_session: newSession });
  return newSession;
}

function redirectToLogin() {
  window.location.href = chrome.runtime.getURL('auth/auth.html');
}

// Supabase REST helper (uses user's JWT for RLS)
async function supaFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers,
  };
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    // Token expired mid-session, try refresh
    const result = await chrome.storage.local.get('pitho_session');
    if (result.pitho_session?.refresh_token) {
      try {
        const refreshed = await refreshToken(result.pitho_session.refresh_token);
        authToken = refreshed.access_token;
        // Retry the request
        headers['Authorization'] = `Bearer ${authToken}`;
        const retry = await fetch(url, { ...options, headers });
        if (!retry.ok) throw new Error(`Supabase ${retry.status}`);
        return retry.json();
      } catch (e) {
        redirectToLogin();
        return [];
      }
    }
    redirectToLogin();
    return [];
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase ${resp.status}: ${text}`);
  }
  return resp.json();
}

let leads = [];
let currentFilter = 'all';
let currentPlatform = 'all';
let searchQuery = '';
let loading = true;

// ── DOM Refs ──
const $ = id => document.getElementById(id);
const leadsBody = $('leadsBody');
const viewTitle = $('viewTitle');
const leadCount = $('leadCount');
const searchInput = $('searchInput');
const platformFilter = $('platformFilter');
const addLeadModal = $('addLeadModal');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const authed = await checkAuth();
  if (!authed) return;

  // Show user info in sidebar
  updateUserInfo();

  bindNav();
  bindFilters();
  bindSearch();
  bindModal();
  bindSettings();
  bindLogout();
  await loadLeads();
});

function updateUserInfo() {
  if (!currentUser) return;
  const userPill = document.querySelector('.user-pill span');
  const userAvatar = document.querySelector('.user-avatar');
  if (userPill) userPill.textContent = currentUser.name || currentUser.email;
  if (userAvatar) userAvatar.textContent = (currentUser.name || currentUser.email)[0].toUpperCase();
}

function bindLogout() {
  const logoutEl = document.querySelector('.sidebar-footer');
  if (logoutEl) {
    logoutEl.style.cursor = 'pointer';
    logoutEl.title = 'Click to sign out';
    logoutEl.addEventListener('click', async () => {
      if (confirm('Sign out of Pitho.ai?')) {
        await chrome.storage.local.remove('pitho_session');
        redirectToLogin();
      }
    });
  }
}

// ── Load leads from Supabase (RLS filters by user automatically) ──
async function loadLeads() {
  loading = true;
  leadsBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-faint)">Loading leads...</td></tr>';
  try {
    const data = await supaFetch('leads?order=last_active.desc');
    leads = data.map(row => ({
      id: row.id,
      name: row.name,
      platform: row.platform || 'other',
      tag: row.tag || 'warm',
      score: row.score || 50,
      lastMsg: row.last_message || '',
      lastActive: timeAgo(row.last_active || row.created_at),
      lastActiveRaw: row.last_active || row.created_at,
      notes: row.notes || '',
      conversationJson: row.conversation_json,
      pageUrl: row.page_url || '',
      replyGenerated: row.reply_generated || '',
    }));
    loading = false;
    renderLeads();
    updateStats();
  } catch (err) {
    console.error('[CRM] Load leads error:', err);
    loading = false;
    leadsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--hot)">Failed to load leads: ${err.message}</td></tr>`;
  }
}

// ── Time ago helper ──
function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr' + (Math.floor(diff / 3600) > 1 ? 's' : '') + ' ago';
  if (diff < 604800) return Math.floor(diff / 86400) + ' day' + (Math.floor(diff / 86400) > 1 ? 's' : '') + ' ago';
  return Math.floor(diff / 604800) + ' week' + (Math.floor(diff / 604800) > 1 ? 's' : '') + ' ago';
}

// ── Navigation ──
function bindNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      $(view + 'View').classList.add('active');
      viewTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);
      if (view === 'pipeline') renderPipeline();
    });
  });
}

// ── Filter Logic ──
function getFiltered() {
  return leads.filter(l => {
    if (currentFilter !== 'all' && l.tag !== currentFilter) return false;
    if (currentPlatform !== 'all' && l.platform !== currentPlatform) return false;
    if (searchQuery && !l.name.toLowerCase().includes(searchQuery) && !l.lastMsg.toLowerCase().includes(searchQuery)) return false;
    return true;
  });
}

function bindFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderLeads();
    });
  });
  platformFilter.addEventListener('change', () => {
    currentPlatform = platformFilter.value;
    renderLeads();
  });
}

function bindSearch() {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase().trim();
    renderLeads();
  });
}

// ── Stats ──
function updateStats() {
  $('statTotal').textContent = leads.length;
  $('statHot').textContent = leads.filter(l => l.tag === 'hot').length;
  $('statWarm').textContent = leads.filter(l => l.tag === 'warm').length;
  $('statCold').textContent = leads.filter(l => l.tag === 'cold').length;
  leadCount.textContent = leads.length + ' contacts';
}

// ── Render Leads Table ──
function renderLeads() {
  const filtered = getFiltered();
  if (filtered.length === 0 && !loading) {
    leadsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-faint)">
      ${leads.length === 0 ? 'No leads yet — analyze a conversation in the extension to auto-add leads' : 'No leads match your filters'}
    </td></tr>`;
    return;
  }
  leadsBody.innerHTML = filtered.map(l => {
    const initials = l.name.split(' ').map(w => w[0]).join('').slice(0, 2);
    const scoreClass = l.score >= 70 ? 'score-high' : l.score >= 40 ? 'score-mid' : 'score-low';
    return `<tr data-id="${l.id}">
      <td><div class="lead-name"><div class="lead-avatar">${initials}</div>${l.name}</div></td>
      <td><span class="platform-badge-sm ${l.platform}">${platformIcon(l.platform)} ${cap(l.platform)}</span></td>
      <td><span class="tag tag-${l.tag}">${cap(l.tag)}</span></td>
      <td class="msg-cell">${l.lastMsg || '<span style="color:var(--text-faint)">No messages</span>'}</td>
      <td><div class="score-bar ${scoreClass}"><div class="score-fill" style="width:${l.score}%"></div></div>${l.score}</td>
      <td><span class="last-active">${l.lastActive}</span></td>
      <td><div class="row-actions">
        <button class="row-btn" title="Change tag" onclick="cycleTag(${l.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button class="row-btn" title="Delete" onclick="deleteLead(${l.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}

function platformIcon(p) {
  const icons = {
    linkedin: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    gmail: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>',
    instagram: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>',
  };
  return icons[p] || '';
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Tag Cycling (persisted to Supabase) ──
async function cycleTag(id) {
  const order = ['cold', 'warm', 'hot'];
  const lead = leads.find(l => l.id === id);
  if (!lead) return;
  const idx = order.indexOf(lead.tag);
  const newTag = order[(idx + 1) % order.length];
  lead.tag = newTag;
  renderLeads();
  updateStats();

  try {
    await supaFetch(`leads?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tag: newTag }),
    });
  } catch (err) {
    console.error('[CRM] Tag update error:', err);
  }
}

// ── Delete Lead (persisted to Supabase) ──
async function deleteLead(id) {
  leads = leads.filter(l => l.id !== id);
  renderLeads();
  updateStats();

  try {
    await supaFetch(`leads?id=eq.${id}`, { method: 'DELETE' });
  } catch (err) {
    console.error('[CRM] Delete error:', err);
  }
}

// ── Pipeline Rendering ──
function renderPipeline() {
  const buckets = { cold: [], warm: [], hot: [], closed: [] };
  leads.forEach(l => {
    if (buckets[l.tag]) buckets[l.tag].push(l);
  });

  ['cold', 'warm', 'hot', 'closed'].forEach(tag => {
    const container = $('pipe' + cap(tag) + 'Cards');
    const count = $('pipe' + cap(tag));
    count.textContent = buckets[tag].length;
    container.innerHTML = buckets[tag].map(l => `
      <div class="pipe-card" data-id="${l.id}">
        <div class="pipe-card-name">${l.name}</div>
        <div class="pipe-card-detail">${l.lastMsg || 'No messages'}</div>
        <div class="pipe-card-platform">${l.platform} · Score: ${l.score}</div>
      </div>
    `).join('') || '<div style="font-size:11px;color:var(--text-faint);text-align:center;padding:20px 0;">No leads</div>';
  });
}

// ── Add Lead Modal (saves to Supabase with user_id) ──
function bindModal() {
  $('addLeadBtn').addEventListener('click', () => addLeadModal.style.display = 'flex');
  $('closeModal').addEventListener('click', () => addLeadModal.style.display = 'none');
  $('cancelModal').addEventListener('click', () => addLeadModal.style.display = 'none');
  addLeadModal.addEventListener('click', e => { if (e.target === addLeadModal) addLeadModal.style.display = 'none'; });

  $('saveLead').addEventListener('click', async () => {
    const name = $('newLeadName').value.trim();
    if (!name) return;

    const btn = $('saveLead');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const newLeadData = {
      user_id: currentUser.id,
      name,
      platform: $('newLeadPlatform').value,
      tag: $('newLeadTag').value,
      score: $('newLeadTag').value === 'hot' ? 80 : $('newLeadTag').value === 'warm' ? 50 : 20,
      last_message: $('newLeadNotes').value.trim(),
      notes: $('newLeadNotes').value.trim(),
    };

    try {
      const result = await supaFetch('leads', {
        method: 'POST',
        body: JSON.stringify(newLeadData),
      });

      if (result && result.length > 0) {
        const row = result[0];
        leads.unshift({
          id: row.id,
          name: row.name,
          platform: row.platform,
          tag: row.tag,
          score: row.score,
          lastMsg: row.last_message || '',
          lastActive: 'Just now',
          lastActiveRaw: row.last_active,
          notes: row.notes || '',
        });
      }

      renderLeads();
      updateStats();
      addLeadModal.style.display = 'none';
      $('newLeadName').value = '';
      $('newLeadNotes').value = '';
    } catch (err) {
      console.error('[CRM] Add lead error:', err);
      alert('Failed to add lead: ' + err.message);
    } finally {
      btn.textContent = 'Add Lead';
      btn.disabled = false;
    }
  });
}

// ── Settings ──
function bindSettings() {
  const saved = localStorage.getItem('pitho_service_context');
  if (saved) $('serviceContext').value = saved;
  $('saveContext').addEventListener('click', () => {
    localStorage.setItem('pitho_service_context', $('serviceContext').value);
    const btn = $('saveContext');
    btn.textContent = 'Saved!';
    btn.style.background = '#22c55e';
    setTimeout(() => { btn.textContent = 'Save Context'; btn.style.background = ''; }, 1500);
  });
}

// ── Auto-refresh every 30 seconds ──
setInterval(() => {
  if (!document.hidden && authToken) loadLeads();
}, 30000);
