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
  const blocks = db.prepare('SELECT id, doc_id, clip_asset_path FROM script_blocks').all();
  let deletedCount = 0;
  let skippedCount = 0;

  for (const block of blocks) {
    const { doc_id, clip_asset_path } = block;
    if (!clip_asset_path) continue;

    const cachePath = path.join(cacheImagesDir, clip_asset_path);
    const destPath = path.join(rendersDir, `doc_${doc_id}`, clip_asset_path);

    if (fs.existsSync(cachePath)) {
      if (fs.existsSync(destPath)) {
        // Safe to delete from cache
        fs.unlinkSync(cachePath);
        console.log(`Deleted from cache: ${clip_asset_path}`);
        deletedCount++;
      } else {
        console.warn(`Skipping deletion: ${clip_asset_path} is NOT present in doc_${doc_id} folder yet.`);
        skippedCount++;
      }
    }
  }

  console.log(`Cleanup finished:`);
  console.log(`- Deleted from cache: ${deletedCount} files`);
  console.log(`- Skipped (not in cache or not verified in doc folder): ${skippedCount} files`);

} catch (err) {
  console.error('Cleanup failed:', err);
} finally {
  db.close();
}
