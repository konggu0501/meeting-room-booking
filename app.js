const STORAGE_KEY = 'meeting-room-bookings-v1';
const currentUser = 'demo-user';
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const toDateString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDate = value => { const [y, m, d] = value.split('-'); return `${Number(m)}月${Number(d)}日`; };
const getBookings = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
const setBookings = list => localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
const dateTime = (date, time) => new Date(`${date}T${time}:00`).getTime();
const futureBookings = () => getBookings().filter(b => dateTime(b.date, b.end) > Date.now()).sort((a,b) => dateTime(a.date,a.start)-dateTime(b.date,b.start));

function render() {
  const list = futureBookings();
  document.querySelector('#booking-count').textContent = list.length ? `${list.length} 条` : '';
  document.querySelector('#booking-list').innerHTML = list.length ? list.map(b => `
    <div class="booking-item"><div><div class="booking-date">${formatDate(b.date)} ${b.start}–${b.end}</div><div class="booking-meta">${escapeHtml(b.department)}</div></div>
    ${b.userId === currentUser ? `<div class="my-booking"><span class="mine-label">我的预约</span><button class="cancel-button" data-id="${b.id}">取消</button></div>` : ''}</div>`).join('') : '<div class="empty-state">暂无未来预约</div>';
  document.querySelectorAll('.cancel-button').forEach(btn => btn.addEventListener('click', () => cancelBooking(btn.dataset.id)));
}
function escapeHtml(value) { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function openModal() { document.querySelector('#booking-modal').classList.remove('hidden'); document.querySelector('#date').min = toDateString(today); const max = new Date(today); max.setDate(max.getDate()+30); document.querySelector('#date').max = toDateString(max); document.querySelector('#date').value = toDateString(today); document.querySelector('#start-time').value = '09:00'; document.querySelector('#end-time').value = '10:00'; document.querySelector('#booking-modal').setAttribute('aria-hidden','false'); }
function closeModal() { document.querySelector('#booking-modal').classList.add('hidden'); document.querySelector('#booking-form').reset(); document.querySelector('#form-error').textContent = ''; }
function showToast(text) { const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1800); }
function cancelBooking(id) { if (!confirm('确定取消这条预约吗？')) return; setBookings(getBookings().filter(b => b.id !== id)); render(); showToast('预约已取消'); }
document.querySelector('#open-booking').addEventListener('click', openModal); document.querySelector('#close-booking').addEventListener('click', closeModal); document.querySelector('[data-close="true"]').addEventListener('click', closeModal);
 document.querySelector('#booking-form').addEventListener('submit', e => { e.preventDefault(); const date = document.querySelector('#date').value, start = document.querySelector('#start-time').value, end = document.querySelector('#end-time').value, department = document.querySelector('#department').value.trim(), contact = document.querySelector('#contact').value.trim(); const error = document.querySelector('#form-error'); if (dateTime(date,end) <= dateTime(date,start)) return error.textContent = '结束时间必须晚于开始时间'; if (dateTime(date,start) < Date.now()) return error.textContent = '不能预约已经开始的时间'; if (!department) return error.textContent = '请填写部门'; if (getBookings().some(b => b.date === date && dateTime(date,start) < dateTime(b.date,b.end) && dateTime(date,end) > dateTime(b.date,b.start))) return error.textContent = '该时间段已被预订，请重新选择'; setBookings([...getBookings(), { id: crypto.randomUUID(), date, start, end, department, contact, userId: currentUser }]); closeModal(); render(); showToast('预订成功'); });
render();
