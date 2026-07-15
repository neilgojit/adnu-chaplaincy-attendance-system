const form = document.getElementById('checkinForm');
const studentNumberInput = document.getElementById('studentNumber');
const ministrySelect = document.getElementById('ministry');
const newStudentFields = document.getElementById('newStudentFields');
const lastNameInput = document.getElementById('lastName');
const firstNameInput = document.getElementById('firstName');
const courseInput = document.getElementById('course');
const submitBtn = document.getElementById('submitBtn');
const messageBox = document.getElementById('messageBox');

let isNewStudent = false;

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
  messageBox.classList.remove('hidden');
}

function clearMessage() {
  messageBox.classList.add('hidden');
}

async function loadMinistries() {
  try {
    const res = await fetch('/api/ministries');
    const list = await res.json();
    ministrySelect.innerHTML = '<option value="" disabled selected>Select your ministry</option>';
    list.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      ministrySelect.appendChild(opt);
    });
  } catch (err) {
    ministrySelect.innerHTML = '<option value="" disabled selected>Could not load ministries</option>';
  }
}

async function checkStudent() {
  const sn = studentNumberInput.value.trim();
  if (!sn) {
    newStudentFields.classList.add('hidden');
    isNewStudent = false;
    return;
  }
  try {
    const res = await fetch(`/api/student/${encodeURIComponent(sn)}`);
    if (res.status === 404) {
      isNewStudent = true;
      newStudentFields.classList.remove('hidden');
    } else {
      isNewStudent = false;
      newStudentFields.classList.add('hidden');
    }
  } catch (err) {
    // network hiccup — let submit handle it
  }
}

studentNumberInput.addEventListener('blur', checkStudent);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();

  const student_number = studentNumberInput.value.trim();
  const ministry = ministrySelect.value;

  if (!student_number || !ministry) {
    showMessage('Please enter your student number and select a ministry.', 'error');
    return;
  }

  const payload = { student_number, ministry };
  if (isNewStudent) {
    if (!lastNameInput.value.trim() || !firstNameInput.value.trim() || !courseInput.value.trim()) {
      showMessage('Please complete your last name, first name, and course.', 'error');
      return;
    }
    payload.last_name = lastNameInput.value.trim();
    payload.first_name = firstNameInput.value.trim();
    payload.course = courseInput.value.trim();
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Recording…';

  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.status === 404 && data.error === 'new_student') {
      isNewStudent = true;
      newStudentFields.classList.remove('hidden');
      showMessage(data.message, 'info');
    } else if (res.status === 409) {
      showMessage(data.message, 'error');
    } else if (!res.ok) {
      showMessage(data.error || 'Something went wrong. Please try again.', 'error');
    } else {
      showMessage(`✅ ${data.message} (${data.ministry})`, 'success');
      form.reset();
      newStudentFields.classList.add('hidden');
      isNewStudent = false;
      ministrySelect.selectedIndex = 0;
    }
  } catch (err) {
    showMessage('Network error. Please check your connection and try again.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Mark Me Present';
  }
});

loadMinistries();
