let adminKey = sessionStorage.getItem('adminKey') || '';

const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const loginMessage = document.getElementById('loginMessage');

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), 'x-admin-key': adminKey }
  });
  if (res.status === 401) {
    sessionStorage.removeItem('adminKey');
    adminKey = '';
    showLogin('Session expired or incorrect password. Please log in again.');
    throw new Error('unauthorized');
  }
  return res;
}

function showLogin(message) {
  loginCard.classList.remove('hidden');
  dashboard.classList.add('hidden');
  if (message) {
    loginMessage.textContent = message;
    loginMessage.classList.remove('hidden');
  }
}

function showDashboard() {
  loginCard.classList.add('hidden');
  dashboard.classList.remove('hidden');
  loadLog();
  loadMinistries();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const key = document.getElementById('adminKey').value;
  adminKey = key;
  try {
    const res = await fetch('/api/admin/log', { headers: { 'x-admin-key': key } });
    if (res.ok) {
      sessionStorage.setItem('adminKey', key);
      showDashboard();
    } else {
      loginMessage.textContent = 'Incorrect password.';
      loginMessage.classList.remove('hidden');
    }
  } catch (err) {
    loginMessage.textContent = 'Network error.';
    loginMessage.classList.remove('hidden');
  }
});

// Tabs
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.panel).classList.add('active');
    if (btn.dataset.panel === 'summaryPanel') loadSummary();
    if (btn.dataset.panel === 'ministryTotalsPanel') loadMinistryTotals();
    if (btn.dataset.panel === 'qrPanel') loadQrCode();
  });
});

async function loadLog() {
  const month = document.getElementById('monthFilter').value;
  const qs = month ? `?month=${month}` : '';
  const res = await api(`/api/admin/log${qs}`);
  const rows = await res.json();
  const tbody = document.getElementById('logBody');
  tbody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(r.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td>
      <td>${r.student_number}</td>
      <td>${r.last_name}, ${r.first_name}</td>
      <td>${r.course}</td>
      <td>${r.ministry}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadSummary() {
  const res = await api('/api/admin/summary');
  const { months, volunteers } = await res.json();

  const thead = document.getElementById('summaryHead');
  thead.innerHTML = `
    <tr>
      <th>Student #</th>
      <th>Name</th>
      <th>Course</th>
      ${months.map((m) => `<th>${m}</th>`).join('')}
      <th>Total Days Present</th>
    </tr>`;

  const tbody = document.getElementById('summaryBody');
  tbody.innerHTML = '';
  volunteers.forEach((v) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.student_number}</td>
      <td>${v.last_name}, ${v.first_name}</td>
      <td>${v.course}</td>
      ${months.map((m) => `<td>${v.months[m] || ''}</td>`).join('')}
      <td><strong>${v.total}</strong></td>`;
    tbody.appendChild(tr);
  });
}

async function loadMinistryTotals() {
  const res = await api('/api/admin/summary-by-ministry');
  const { months, ministries } = await res.json();

  const thead = document.getElementById('ministryTotalsHead');
  thead.innerHTML = `
    <tr>
      <th>Ministry</th>
      ${months.map((m) => `<th>${m}</th>`).join('')}
      <th>Total Check-ins</th>
    </tr>`;

  const tbody = document.getElementById('ministryTotalsBody');
  tbody.innerHTML = '';
  ministries.forEach((m) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.ministry}</td>
      ${months.map((month) => `<td>${m.months[month] || ''}</td>`).join('')}
      <td><strong>${m.total}</strong></td>`;
    tbody.appendChild(tr);
  });
}

async function loadQrCode() {
  try {
    const res = await api('/api/admin/qrcode');
    const { url, qrDataUrl } = await res.json();
    document.getElementById('qrImage').src = qrDataUrl;
    document.getElementById('qrUrl').textContent = url;
  } catch (err) {
    // api() already redirects to login on 401; ignore other errors silently
  }
}

async function loadMinistries() {
  const res = await fetch('/api/ministries');
  const list = await res.json();
  const ul = document.getElementById('ministryList');
  ul.innerHTML = '';
  list.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${m.name}</span> <button data-id="${m.id}">Remove</button>`;
    li.querySelector('button').addEventListener('click', async () => {
      await api(`/api/ministries/${m.id}`, { method: 'DELETE' });
      loadMinistries();
    });
    ul.appendChild(li);
  });
}

document.getElementById('refreshLogBtn').addEventListener('click', loadLog);
document.getElementById('monthFilter').addEventListener('change', loadLog);
document.getElementById('refreshSummaryBtn').addEventListener('click', loadSummary);
document.getElementById('refreshMinistryTotalsBtn').addEventListener('click', loadMinistryTotals);
document.getElementById('refreshQrBtn').addEventListener('click', loadQrCode);
document.getElementById('downloadQrBtn').addEventListener('click', () => {
  window.location.href = `/api/admin/qrcode.png?key=${encodeURIComponent(adminKey)}`;
});

document.getElementById('exportBtn').addEventListener('click', () => {
  window.location.href = `/api/admin/export?key=${encodeURIComponent(adminKey)}`;
});

document.getElementById('addMinistryBtn').addEventListener('click', async () => {
  const input = document.getElementById('newMinistryName');
  if (!input.value.trim()) return;
  await api('/api/ministries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.value.trim() })
  });
  input.value = '';
  loadMinistries();
});

// Auto-login if we already have a stored key
if (adminKey) {
  fetch('/api/admin/log', { headers: { 'x-admin-key': adminKey } }).then((res) => {
    if (res.ok) showDashboard();
    else showLogin();
  });
} else {
  showLogin();
}
