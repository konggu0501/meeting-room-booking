const SUPABASE_URL = 'https://mibxqjimftelazbkfpjl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pYnhxamltZnRlbGF6YmtmcGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDY1NjIsImV4cCI6MjEwMTkyMjU2Mn0.W1snZ6TcJlyNsU_R37RkNtw5ERQVfcPUC7EpRb0eeww';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const CLIENT_ID_KEY = 'meeting-room-client-id';
const currentUser = localStorage.getItem(CLIENT_ID_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_ID_KEY, currentUser);
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const toDateString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDate = value => { const [, m, d] = value.split('-'); return `${Number(m)}月${Number(d)}日`; };
const dateTime = (date, time) => new Date(`${date}T${time}:00`).getTime();
const escapeHtml = value => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function getBookings() {
  const { data, error } = await db.from('bookings').select('*').order('date').order('start_time');
  if (error) throw error;
  return data || [];
}

async function render() {
  const listEl = document.querySelector('#booking-list');
  try {
    const list = (await getBookings()).filter(b => dateTime(b.date, b.end_time) > Date.now());
    document.querySelector('#booking-count').textContent = list.length ? `${list.length} 条` : '';
    listEl.innerHTML = list.length ? list.map(b => `
      <div class="booking-item"><div><div class="booking-date">${formatDate(b.date)} ${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)}</div><div class="booking-meta">${escapeHtml(b.department)}</div></div>
      ${b.client_id === currentUser ? `<div class="my-booking"><span class="mine-label">我的预约</span><button class="cancel-button" data-id="${b.id}">取消</button></div>` : ''}</div>`).join('') : '<div class="empty-state">暂无未来预约</div>';
    document.querySelectorAll('.cancel-button').forEach(btn => btn.addEventListener('click', () => cancelBooking(btn.dataset.id)));
  } catch (error) {
    listEl.innerHTML = '<div class="empty-state">预约数据暂时无法加载，请稍后刷新</div>';
    console.error(error);
  }
}

function openModal() { const modal = document.querySelector('#booking-modal'); modal.classList.remove('hidden'); const date = document.querySelector('#date'); date.min = toDateString(today); const max = new Date(today); max.setDate(max.getDate()+30); date.max = toDateString(max); date.value = toDateString(today); document.querySelector('#start-time').value = '09:00'; document.querySelector('#end-time').value = '10:00'; }
function closeModal() { document.querySelector('#booking-modal').classList.add('hidden'); document.querySelector('#booking-form').reset(); document.querySelector('#form-error').textContent = ''; }
function showToast(text) { const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1800); }

async function cancelBooking(id) {
  if (!confirm('确定取消这条预约吗？')) return;
  const { error } = await db.from('bookings').delete().eq('id', id).eq('client_id', currentUser);
  if (error) return showToast('取消失败，请稍后再试');
  await render(); showToast('预约已取消');
}

document.querySelector('#open-booking').addEventListener('click', openModal);
document.querySelector('#close-booking').addEventListener('click', closeModal);
document.querySelector('[data-close="true"]').addEventListener('click', closeModal);
document.querySelector('#booking-form').addEventListener('submit', async e => {
  e.preventDefault();
  const date = document.querySelector('#date').value, start = document.querySelector('#start-time').value, end = document.querySelector('#end-time').value, department = document.querySelector('#department').value.trim(), contact = document.querySelector('#contact').value.trim();
  const errorEl = document.querySelector('#form-error');
  if (dateTime(date,end) <= dateTime(date,start)) return errorEl.textContent = '结束时间必须晚于开始时间';
  if (dateTime(date,start) < Date.now()) return errorEl.textContent = '不能预约已经开始的时间';
  if (!department) return errorEl.textContent = '请填写部门';
  const existing = await getBookings();
  if (existing.some(b => b.date === date && dateTime(date,start) < dateTime(b.date,b.end_time) && dateTime(date,end) > dateTime(b.date,b.start_time))) return errorEl.textContent = '该时间段已被预订，请重新选择';
  const { error } = await db.from('bookings').insert({ date, start_time: start, end_time: end, department, contact: contact || null, client_id: currentUser });
  if (error) return errorEl.textContent = '预约失败，请稍后再试';
  closeModal(); await render(); showToast('预订成功');
});

render();
