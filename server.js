const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
// Render/Railway/etc. terminate HTTPS at a proxy and forward plain HTTP
// internally. Without this, req.protocol would report "http" even when the
// site is actually served over https, which would make the QR code embed
// the wrong scheme.
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chaplaincy2026';
const TIMEZONE = 'Asia/Manila';

// ---------- helpers ----------

function todayString() {
  // YYYY-MM-DD in Asia/Manila, regardless of server's own timezone
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(new Date()); // en-CA gives YYYY-MM-DD
}

function nowIso() {
  return new Date().toISOString();
}

function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key') || req.query.key;
  if (key !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized. Admin key required.' });
  }
  next();
}

function fullName(student) {
  return `${student.last_name}, ${student.first_name}`;
}

// Prefer an explicit PUBLIC_URL env var (useful if the app sits behind a
// custom domain or proxy that mangles req.protocol/host); otherwise fall
// back to whatever the incoming request says.
function checkinUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '') + '/';
  return `${req.protocol}://${req.get('host')}/`;
}

// ---------- public: ministries ----------

app.get('/api/ministries', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM ministries ORDER BY name').all();
  res.json(rows);
});

// ---------- public: student lookup ----------

app.get('/api/student/:studentNumber', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE student_number = ?')
    .get(req.params.studentNumber.trim());
  if (!student) return res.status(404).json({ found: false });
  res.json({ found: true, student });
});

// ---------- public: check-in ----------

app.post('/api/checkin', (req, res) => {
  const { student_number, ministry, last_name, first_name, course } = req.body || {};

  if (!student_number || !student_number.trim()) {
    return res.status(400).json({ error: 'Student number is required.' });
  }
  if (!ministry || !ministry.trim()) {
    return res.status(400).json({ error: 'Ministry is required.' });
  }

  const studentNumber = student_number.trim();

  let student = db
    .prepare('SELECT * FROM students WHERE student_number = ?')
    .get(studentNumber);

  if (!student) {
    if (!last_name || !first_name || !course) {
      // Signal the frontend to show registration fields
      return res.status(404).json({
        error: 'new_student',
        message: 'Student not found. Please provide last name, first name, and course to register.'
      });
    }
    db.prepare(
      `INSERT INTO students (student_number, last_name, first_name, course, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(studentNumber, last_name.trim(), first_name.trim(), course.trim(), nowIso());

    student = db.prepare('SELECT * FROM students WHERE student_number = ?').get(studentNumber);
  }

  const date = todayString();
  const timestamp = nowIso();

  try {
    db.prepare(
      `INSERT INTO attendance (student_number, ministry, date, "timestamp")
       VALUES (?, ?, ?, ?)`
    ).run(studentNumber, ministry.trim(), date, timestamp);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db
        .prepare(
          'SELECT * FROM attendance WHERE student_number = ? AND date = ?'
        )
        .get(studentNumber, date);
      return res.status(409).json({
        error: 'already_recorded',
        message: `${fullName(student)} was already marked present today at ${new Date(
          existing.timestamp
        ).toLocaleTimeString('en-PH', { timeZone: TIMEZONE })} (${existing.ministry}).`
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  res.json({
    success: true,
    message: `Present recorded for ${fullName(student)}.`,
    student: { ...student, full_name: fullName(student) },
    ministry: ministry.trim(),
    date,
    timestamp
  });
});

// ---------- admin: QR code linking to the check-in page ----------
// (Print this near the chapel entrance so volunteers can scan straight
// into the check-in form.)

app.get('/api/admin/qrcode', requireAdmin, async (req, res) => {
  try {
    const url = checkinUrl(req);
    const qrDataUrl = await QRCode.toDataURL(url, { width: 500, margin: 2 });
    res.json({ url, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

// Printable/downloadable PNG version (uses the same ?key= admin-key
// pattern as the Excel export link, so it works as a plain <img src>).
app.get('/api/admin/qrcode.png', requireAdmin, async (req, res) => {
  try {
    const url = checkinUrl(req);
    const buffer = await QRCode.toBuffer(url, { width: 1000, margin: 2, type: 'png' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="chaplaincy_checkin_qr.png"');
    res.end(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

// ---------- admin: ministries management ----------

app.post('/api/ministries', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Ministry name required.' });
  try {
    db.prepare('INSERT INTO ministries (name) VALUES (?)').run(name.trim());
  } catch (err) {
    return res.status(409).json({ error: 'Ministry already exists.' });
  }
  res.json({ success: true });
});

app.delete('/api/ministries/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM ministries WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---------- admin: view log / summary ----------

app.get('/api/admin/log', requireAdmin, (req, res) => {
  const { month } = req.query; // optional YYYY-MM
  let rows;
  if (month) {
    rows = db
      .prepare(
        `SELECT a.id, a."timestamp", a.date, a.ministry,
                s.student_number, s.last_name, s.first_name, s.course
         FROM attendance a JOIN students s ON s.student_number = a.student_number
         WHERE a.date LIKE ?
         ORDER BY a."timestamp" DESC`
      )
      .all(`${month}%`);
  } else {
    rows = db
      .prepare(
        `SELECT a.id, a."timestamp", a.date, a.ministry,
                s.student_number, s.last_name, s.first_name, s.course
         FROM attendance a JOIN students s ON s.student_number = a.student_number
         ORDER BY a."timestamp" DESC
         LIMIT 500`
      )
      .all();
  }
  res.json(rows);
});

app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const flatRows = db
    .prepare(
      `SELECT s.student_number, s.last_name, s.first_name, s.course,
              substr(a.date, 1, 7) AS month,
              COUNT(DISTINCT a.date) AS days_present
       FROM attendance a JOIN students s ON s.student_number = a.student_number
       GROUP BY s.student_number, month`
    )
    .all();

  const months = [...new Set(flatRows.map((r) => r.month))].sort();

  const byStudent = {};
  flatRows.forEach((r) => {
    if (!byStudent[r.student_number]) {
      byStudent[r.student_number] = {
        student_number: r.student_number,
        last_name: r.last_name,
        first_name: r.first_name,
        course: r.course,
        months: {},
        total: 0
      };
    }
    byStudent[r.student_number].months[r.month] = r.days_present;
    byStudent[r.student_number].total += r.days_present;
  });

  const volunteers = Object.values(byStudent).sort((a, b) =>
    a.last_name.localeCompare(b.last_name)
  );

  res.json({ months, volunteers });
});

app.get('/api/admin/summary-by-ministry', requireAdmin, (req, res) => {
  const flatRows = db
    .prepare(
      `SELECT ministry, substr(date, 1, 7) AS month, COUNT(*) AS visits
       FROM attendance
       GROUP BY ministry, month`
    )
    .all();

  const months = [...new Set(flatRows.map((r) => r.month))].sort();

  const byMinistry = {};
  flatRows.forEach((r) => {
    if (!byMinistry[r.ministry]) {
      byMinistry[r.ministry] = { ministry: r.ministry, months: {}, total: 0 };
    }
    byMinistry[r.ministry].months[r.month] = r.visits;
    byMinistry[r.ministry].total += r.visits;
  });

  const ministries = Object.values(byMinistry).sort((a, b) =>
    a.ministry.localeCompare(b.ministry)
  );

  res.json({ months, ministries });
});

// ---------- admin: export to Excel ----------

app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ateneo de Naga University - Chaplaincy Student Volunteers';
  workbook.created = new Date();

  const blueFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A6B' } };
  const goldFont = { color: { argb: 'FFFFC72C' }, bold: true };

  // --- Attendance Log sheet ---
  const logSheet = workbook.addWorksheet('Attendance Log');
  logSheet.columns = [
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Student Number', key: 'student_number', width: 16 },
    { header: 'Full Name (Last, First)', key: 'full_name', width: 28 },
    { header: 'Course', key: 'course', width: 16 },
    { header: 'Ministry', key: 'ministry', width: 22 }
  ];
  logSheet.getRow(1).eachCell((cell) => {
    cell.fill = blueFill;
    cell.font = goldFont;
  });

  const logRows = db
    .prepare(
      `SELECT a."timestamp", a.date, s.student_number, s.last_name, s.first_name, s.course, a.ministry
       FROM attendance a JOIN students s ON s.student_number = a.student_number
       ORDER BY a."timestamp" DESC`
    )
    .all();
  logRows.forEach((r) => {
    logSheet.addRow({
      timestamp: new Date(r.timestamp).toLocaleString('en-PH', { timeZone: TIMEZONE }),
      date: r.date,
      student_number: r.student_number,
      full_name: `${r.last_name}, ${r.first_name}`,
      course: r.course,
      ministry: r.ministry
    });
  });

  // --- Students master sheet ---
  const studentsSheet = workbook.addWorksheet('Students');
  studentsSheet.columns = [
    { header: 'Student Number', key: 'student_number', width: 16 },
    { header: 'Last Name', key: 'last_name', width: 20 },
    { header: 'First Name', key: 'first_name', width: 20 },
    { header: 'Course', key: 'course', width: 16 },
    { header: 'Registered On', key: 'created_at', width: 22 }
  ];
  studentsSheet.getRow(1).eachCell((cell) => {
    cell.fill = blueFill;
    cell.font = goldFont;
  });
  const students = db.prepare('SELECT * FROM students ORDER BY last_name, first_name').all();
  students.forEach((s) => {
    studentsSheet.addRow({
      student_number: s.student_number,
      last_name: s.last_name,
      first_name: s.first_name,
      course: s.course,
      created_at: new Date(s.created_at).toLocaleString('en-PH', { timeZone: TIMEZONE })
    });
  });

  // --- Monthly Summary sheet (pivot: student x month = days present) ---
  const summarySheet = workbook.addWorksheet('Monthly Summary');
  const summaryRows = db
    .prepare(
      `SELECT s.student_number, s.last_name, s.first_name, s.course,
              substr(a.date, 1, 7) AS month,
              COUNT(DISTINCT a.date) AS days_present
       FROM attendance a JOIN students s ON s.student_number = a.student_number
       GROUP BY s.student_number, month`
    )
    .all();

  const months = [...new Set(summaryRows.map((r) => r.month))].sort();
  const byStudent = {};
  summaryRows.forEach((r) => {
    const key = r.student_number;
    if (!byStudent[key]) {
      byStudent[key] = {
        student_number: r.student_number,
        last_name: r.last_name,
        first_name: r.first_name,
        course: r.course,
        months: {}
      };
    }
    byStudent[key].months[r.month] = r.days_present;
  });

  const summaryColumns = [
    { header: 'Student Number', key: 'student_number', width: 16 },
    { header: 'Full Name (Last, First)', key: 'full_name', width: 28 },
    { header: 'Course', key: 'course', width: 16 },
    ...months.map((m) => ({ header: m, key: m, width: 12 })),
    { header: 'Total Days Present', key: 'total', width: 18 }
  ];
  summarySheet.columns = summaryColumns;
  summarySheet.getRow(1).eachCell((cell) => {
    cell.fill = blueFill;
    cell.font = goldFont;
  });

  Object.values(byStudent)
    .sort((a, b) => a.last_name.localeCompare(b.last_name))
    .forEach((s) => {
      const row = {
        student_number: s.student_number,
        full_name: `${s.last_name}, ${s.first_name}`,
        course: s.course
      };
      let total = 0;
      months.forEach((m) => {
        const v = s.months[m] || 0;
        row[m] = v || '';
        total += v;
      });
      row.total = total;
      summarySheet.addRow(row);
    });

  // --- Per-Ministry Monthly Totals sheet (pivot: ministry x month = total check-ins) ---
  const ministrySheet = workbook.addWorksheet('Per-Ministry Totals');
  const ministryRows = db
    .prepare(
      `SELECT ministry, substr(date, 1, 7) AS month, COUNT(*) AS visits
       FROM attendance
       GROUP BY ministry, month`
    )
    .all();

  const ministryMonths = [...new Set(ministryRows.map((r) => r.month))].sort();
  const byMinistry = {};
  ministryRows.forEach((r) => {
    if (!byMinistry[r.ministry]) {
      byMinistry[r.ministry] = { ministry: r.ministry, months: {} };
    }
    byMinistry[r.ministry].months[r.month] = r.visits;
  });

  ministrySheet.columns = [
    { header: 'Ministry', key: 'ministry', width: 26 },
    ...ministryMonths.map((m) => ({ header: m, key: m, width: 12 })),
    { header: 'Total Check-ins', key: 'total', width: 16 }
  ];
  ministrySheet.getRow(1).eachCell((cell) => {
    cell.fill = blueFill;
    cell.font = goldFont;
  });

  Object.values(byMinistry)
    .sort((a, b) => a.ministry.localeCompare(b.ministry))
    .forEach((m) => {
      const row = { ministry: m.ministry };
      let total = 0;
      ministryMonths.forEach((month) => {
        const v = m.months[month] || 0;
        row[month] = v || '';
        total += v;
      });
      row.total = total;
      ministrySheet.addRow(row);
    });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="chaplaincy_attendance_${todayString()}.xlsx"`
  );
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Chaplaincy attendance server running on port ${PORT}`);
});
