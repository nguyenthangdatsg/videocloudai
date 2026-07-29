const db = require('better-sqlite3')('database/videocloudai.db');
const DOC_ID = process.argv[2] || 'e8080c45-624a-4f48-82c6-66886f8c2a74';
const blocks = db.prepare('SELECT block_index, segment_index, segment_name, scene_number, narration FROM script_blocks WHERE doc_id=? ORDER BY block_index').all(DOC_ID);
let prevSeg = -1;
for (const b of blocks) {
  if (b.segment_index !== prevSeg) {
    console.log('\nSegment ' + b.segment_index + ' — ' + b.segment_name);
    prevSeg = b.segment_index;
  }
  console.log('  [block ' + b.block_index + '] scene_number=' + b.scene_number + ' | ' + b.narration.slice(0, 70).replace(/\n/g, ' '));
}
db.close();
