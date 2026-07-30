const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve('database/videocloudai.db');
const cacheImagesDir = path.resolve('cache/images');
const rendersDir = path.resolve('renders/storyboard');

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

try {
  const blocks = db.prepare('SELECT id, doc_id, clip_asset_path, visual_type FROM script_blocks').all();
  console.log(`Found ${blocks.length} blocks in database.`);

  let migratedCount = 0;
  let skippedCount = 0;
  let missingCount = 0;

  for (const block of blocks) {
    const { doc_id, clip_asset_path } = block;
    if (!clip_asset_path) {
      skippedCount++;
      continue;
    }

    const srcPath = path.join(cacheImagesDir, clip_asset_path);
    const docDir = path.join(rendersDir, `doc_${doc_id}`);
    const destPath = path.join(docDir, clip_asset_path);

    if (fs.existsSync(srcPath)) {
      if (!fs.existsSync(docDir)) {
        fs.mkdirSync(docDir, { recursive: true });
      }
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${clip_asset_path} -> doc_${doc_id}`);
        migratedCount++;
      } else {
        skippedCount++;
      }
    } else {
      // Check if it already exists in the destination (migrated previously or downloaded directly)
      if (fs.existsSync(destPath)) {
        skippedCount++;
      } else {
        console.warn(`File missing in cache: ${clip_asset_path} (for doc_${doc_id})`);
        missingCount++;
      }
    }
  }

  console.log(`Migration finished:`);
  console.log(`- Migrated: ${migratedCount} files`);
  console.log(`- Skipped (already in dest or no clip): ${skippedCount} files`);
  console.log(`- Missing in cache: ${missingCount} files`);

} catch (err) {
  console.error('Migration failed:', err);
} finally {
  db.close();
}
