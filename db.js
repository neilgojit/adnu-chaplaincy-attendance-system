const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DB file lives in ./data by default. On hosts like Render, point DB_PATH
// at a mounted persistent disk (e.g. /data/attendance.db) so records are
// never lost on redeploy.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'attendance.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;'); // safer + faster concurrent writes
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    student_number TEXT PRIMARY KEY,
    last_name      TEXT NOT NULL,
    first_name     TEXT NOT NULL,
    course         TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ministries (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number TEXT NOT NULL REFERENCES students(student_number),
    ministry       TEXT NOT NULL,
    date           TEXT NOT NULL,   -- YYYY-MM-DD, local (Asia/Manila)
    "timestamp"    TEXT NOT NULL,   -- ISO datetime of check-in
    UNIQUE(student_number, date)
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_number);
`);

// Seed a starter list of ministries if the table is empty.
// Edit/add/remove these anytime from the Admin page.
const ministryCount = db.prepare('SELECT COUNT(*) AS c FROM ministries').get().c;
if (ministryCount === 0) {
  const seed = db.prepare('INSERT INTO ministries (name) VALUES (?)');
  const defaults = [
    'Altar Ministry',
    'Proclamation Ministry',
    'Music Ministry'
  ];
  defaults.forEach((n) => seed.run(n));
}

module.exports = db;
