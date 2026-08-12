const SUPABASE_URL = 'https://mibxqjimftelazbkfpjl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pYnhxamltZnRlbGF6YmtmcGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDY1NjIsImV4cCI6MjEwMTkyMjU2Mn0.W1snZ6TcJlyNsU_R37RkNtw5ERQVfcPUC7EpRb0eeww';
const API_URL = `${SUPABASE_URL}/rest/v1/bookings`;
const CLIENT_ID_KEY = 'meeting-room-client-id';
const CLIENT_COOKIE_KEY = 'meeting_room_client_id';

function readLocalClientId() {
  try { return localStorage.getItem(CLIENT_ID_KEY) || ''; } catch { return ''; }
}

function readCookieClientId() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CLIENT_COOKIE_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

const localClientId = readLocalClientId();
const cookieClientId = readCookieClientId();
const currentUser = localClientId || cookieClientId || crypto.randomUUID();
const knownClientIds = new Set([currentUser, localClientId, cookieClientId].filter(Boolean));

try { localStorage.setItem(CLIENT_ID_KEY, currentUser); } catch {}
document.cookie = `${CLIENT_COOKIE_KEY}=${encodeURIComponent(currentUser)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;

const pad = n => String(n).padStart(2, '0');
const toDateString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDate = value => { const [, m, d] = value.split('-'); return `${Number(m)}月${Number(d)}日`; };
const dateTime = (date, time) => new Date(`${date}T${String(time).slice(0, 5)}:00`).getTime();
const escapeHtml = value => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const apiHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });
const timeOptions = Array.from({ length: 48 }, (_, index) => `${pad(Math.floor(index / 2))}:${index % 2 ? '30' : '00'}`);

let cleanupPromise;
let latestRender = 0;
let submitting = false;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function populateTimeSelects() {
  const options = timeOptions.map(time => `<option value="${time}">${time}</option>`).join('');
  document.querySelector('#start-time').innerHTML = options;
  document.querySelector('#end-time').innerHTML = options;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getBookings() {
  const start = toDateString(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  const fields = 'id,date,start_time,end_time,name:department,client_id';
  const url = `${API_URL}?select=${fields}&date=gte.${start}&date=lte.${toDateString(endDate)}&order=date.asc,start_time.asc`;
  const response = await fetchWithTimeout(url, { headers: apiHeaders(), cache: 'no-store' });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function cleanupPastBookings() {
  if (!cleanupPromise) {
    const cutoff = toDateString(new Date());
    cleanupPromise = fetchWithTimeout(`${API_URL}?date=lt.${cutoff}`, { method: 'DELETE', headers: apiHeaders() })
      .then(response => { if (!response.ok) throw new Error('历史预约清理失败'); })
      .catch(error => console.warn(error));
  }
  return cleanupPromise;
}

async function findConflict(date, start, end) {
  const url = `${API_URL}?select=id,client_id&date=eq.${date}&start_time=lt.${encodeURIComponent(end)}&end_time=gt.${encodeURIComponent(start)}&limit=1`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers: apiHeaders(), cache: 'no-store' }, 12000);
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      return rows[0] || null;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(600);
    }
  }
  throw lastError;
}

async function findBooking(id) {
  const response = await fetchWithTimeout(`${API_URL}?select=id,client_id&id=eq.${id}&limit=1`, { headers: apiHeaders(), cache: 'no-store' });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

async function verifyOwnedBooking(id) {
  for (const delay of [0, 500, 1200, 2400]) {
    if (delay) await sleep(delay);
    const booking = await findBooking(id).catch(() => null);
    if (booking) return knownClientIds.has(booking.client_id) ? booking : null;
  }
  return null;
}

async function deterministicBookingId(date, start, end) {
  const input = new TextEncoder().encode(`meeting-room|${date}|${start}|${end}`);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function render() {
  const renderId = ++latestRender;
  const listEl = document.querySelector('#booking-list');
  if (!listEl.querySelector('.booking-item')) listEl.innerHTML = '<div class="empty-state">加载中…</div>';
  cleanupPastBookings();

  try {
    const list = (await getBookings()).filter(booking => dateTime(booking.date, booking.end_time) > Date.now());
    if (renderId !== latestRender) return;
    renderBookings(list);
  } catch (error) {
    if (renderId !== latestRender) return;
    listEl.innerHTML = '<div class="empty-state">预约数据暂时无法加载，请稍后刷新</div>';
    console.error(error);
  }
}

function renderBookings(list) {
  const listEl = document.querySelector('#booking-list');
  document.querySelector('#booking-count').textContent = list.length ? `${list.length} 条` : '';
  listEl.innerHTML = list.length ? list.map(booking => `
    <div class="booking-item"><div><div class="booking-date">${formatDate(booking.date)} ${booking.start_time.slice(0,5)}–${booking.end_time.slice(0,5)}</div><div class="booking-meta">${escapeHtml(booking.name)}</div></div>
    ${knownClientIds.has(booking.client_id) ? `<div class="my-booking"><span class="mine-label">我的预约</span><button class="cancel-button" data-id="${booking.id}">取消</button></div>` : ''}</div>`).join('') : '<div class="empty-state">暂无未来预约</div>';
  document.querySelectorAll('.cancel-button').forEach(button => button.addEventListener('click', () => cancelBooking(button.dataset.id, button)));
}

function openModal() {
  const now = new Date();
  const modal = document.querySelector('#booking-modal');
  const date = document.querySelector('#date');
  const max = new Date(now);
  max.setDate(max.getDate() + 30);
  modal.classList.remove('hidden');
  date.min = toDateString(now);
  date.max = toDateString(max);
  date.value = toDateString(now);
  document.querySelector('#start-time').value = '09:00';
  document.querySelector('#end-time').value = '10:00';
}

function closeModal() {
  if (submitting) return;
  document.querySelector('#booking-modal').classList.add('hidden');
  document.querySelector('#booking-form').reset();
  document.querySelector('#form-error').textContent = '';
}

function showToast(text) {
  const el = document.querySelector('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function setSubmitting(active) {
  submitting = active;
  const button = document.querySelector('#booking-form button[type="submit"]');
  button.disabled = active;
  button.textContent = active ? '提交中…' : '确认预订';
}

async function cancelBooking(id, button) {
  if (!confirm('确定取消这条预约吗？')) return;
  button.disabled = true;
  try {
    const ownerIds = [...knownClientIds].map(value => `"${value.replaceAll('"', '')}"`).join(',');
    const response = await fetchWithTimeout(`${API_URL}?id=eq.${encodeURIComponent(id)}&client_id=in.(${encodeURIComponent(ownerIds)})`, { method: 'DELETE', headers: apiHeaders() });
    if (!response.ok) throw new Error(await response.text());
    await render();
    showToast('预约已取消');
  } catch (error) {
    button.disabled = false;
    showToast('取消失败，请稍后再试');
  }
}

document.querySelector('#open-booking').addEventListener('click', openModal);
document.querySelector('#close-booking').addEventListener('click', closeModal);
document.querySelector('[data-close="true"]').addEventListener('click', closeModal);
document.querySelector('#booking-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;

  const date = document.querySelector('#date').value;
  const start = document.querySelector('#start-time').value;
  const end = document.querySelector('#end-time').value;
  const name = document.querySelector('#name').value.trim();
  const errorEl = document.querySelector('#form-error');

  errorEl.textContent = '';
  if (dateTime(date, end) <= dateTime(date, start)) return errorEl.textContent = '结束时间必须晚于开始时间';
  if (dateTime(date, start) < Date.now()) return errorEl.textContent = '不能预约已经开始的时间';
  if (!name) return errorEl.textContent = '请填写姓名';

  setSubmitting(true);
  let id;

  try {
    id = await deterministicBookingId(date, start, end);
    const conflict = await findConflict(date, start, end);
    if (conflict) {
      if (conflict.id === id && knownClientIds.has(conflict.client_id)) {
        setSubmitting(false);
        closeModal();
        await render();
        return showToast('预约已保存');
      }
      errorEl.textContent = '该时间段已被预订，请重新选择';
      return;
    }

    let response;
    let requestError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetchWithTimeout(API_URL, {
          method: 'POST',
          headers: { ...apiHeaders(), Prefer: 'return=minimal' },
          body: JSON.stringify({ id, date, start_time: start, end_time: end, department: name, client_id: currentUser })
        }, 20000);
        if (response.ok) break;
        if (response.status !== 409) throw new Error(await response.text());
      } catch (error) {
        requestError = error;
      }

      const existing = await verifyOwnedBooking(id);
      if (existing) {
        response = { ok: true };
        break;
      }
      if (response?.status === 409) {
        errorEl.textContent = '该时间段刚刚被预订，请重新选择';
        return;
      }
      if (attempt === 0) await sleep(800);
    }

    if (!response?.ok) throw requestError || new Error('预约请求未确认');

    setSubmitting(false);
    closeModal();
    await render();
    showToast('预订成功');
  } catch (error) {
    const existing = id ? await verifyOwnedBooking(id) : null;
    if (existing) {
      setSubmitting(false);
      closeModal();
      await render();
      showToast('预约已保存');
    } else {
      errorEl.textContent = error.name === 'AbortError' ? '网络较慢，未确认结果，请稍后重试' : '预约失败，请稍后再试';
    }
  } finally {
    setSubmitting(false);
  }
});

populateTimeSelects();
render();
