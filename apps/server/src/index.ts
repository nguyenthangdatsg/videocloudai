import * as path from 'path';
import * as net from 'net';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

// Load .env: server dir first, then monorepo root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Resolve relative paths in env vars against monorepo root (not CWD)
const monoRoot = path.resolve(__dirname, '../../..');
for (const key of ['RENDERS_DIR', 'ASSETS_DIR', 'DATABASE_PATH', 'CACHE_DIR']) {
  const v = process.env[key];
  if (v && !path.isAbsolute(v)) process.env[key] = path.resolve(monoRoot, v);
}

import { getDb } from './db';
import { initProviders } from './providers';
import { getJobQueue } from './queue/queue';
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3001');

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => { tester.close(); resolve(false); })
      .listen(port, '0.0.0.0');
  });
}

function killProcessOnPort(port: number): void {
  try {
    const result = execSync(
      `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const lines = result.trim().split('\n');
    const pids = new Set<string>();
    for (const line of lines) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      console.log(`Killing stale process on port ${port} (PID ${pid})...`);
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
    }
  } catch {
    // No process found or kill failed — will surface as EADDRINUSE later
  }
}

async function main() {
  // Kill stale process on our port (Windows doesn't reliably deliver SIGTERM)
  if (await isPortInUse(PORT)) {
    console.log(`Port ${PORT} is in use, attempting to kill stale process...`);
    killProcessOnPort(PORT);
    // Brief wait for port to be released
    await new Promise((r) => setTimeout(r, 500));
  }

  // Init database
  getDb();
  console.log('Database initialized.');

  // Init AI providers
  initProviders();
  console.log('Providers initialized.');

  // Init job queue
  getJobQueue();
  console.log('Job queue initialized.');

  const app = createApp();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`VideoCloudAI server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
    console.log(`SSE events: http://localhost:${PORT}/api/events`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use.`);
      console.error(`   A stale server process may still be running.`);
      console.error(`   Kill it with: taskkill /F /PID $(netstat -ano | grep ":${PORT}" | head -1 | awk '{print $NF}')\n`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });

  // Graceful shutdown for ts-node-dev restart
  const shutdown = () => { server.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
