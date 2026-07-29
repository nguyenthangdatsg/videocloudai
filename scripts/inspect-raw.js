const db = require('better-sqlite3')('database/videocloudai.db');
const DOC_ID = process.argv[2] || 'e8080c45-624a-4f48-82c6-66886f8c2a74';
const raw = db.prepare('SELECT raw_markdown FROM script_docs WHERE id = ?').get(DOC_ID).raw_markdown;
db.close();
const lines = raw.split(/\r?\n/);
// Print first 60 lines with line number and hex of first char
lines.slice(0, 60).forEach((l, i) => {
  const hex = l.charCodeAt(0).toString(16).padStart(4, '0');
  console.log((i+1).toString().padStart(3), hex, JSON.stringify(l.slice(0, 100)));
});
