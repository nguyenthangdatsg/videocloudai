#!/usr/bin/env node
// Cross-platform port killer — used as pre-dev cleanup
// Usage: node scripts/kill-port.js <port>

const { execSync } = require('child_process');
const os = require('os');

const port = parseInt(process.argv[2]);
if (!port) {
  console.error('Usage: node scripts/kill-port.js <port>');
  process.exit(1);
}

try {
  if (os.platform() === 'win32') {
    const result = execSync(
      `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const pids = new Set();
    for (const line of result.trim().split('\n')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      console.log(`Killing stale process on port ${port} (PID ${pid})`);
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
    }
  } else {
    const result = execSync(`lsof -ti :${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const pid of result.trim().split('\n').filter(Boolean)) {
      console.log(`Killing stale process on port ${port} (PID ${pid})`);
      execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
    }
  }
} catch {
  // No process on this port — nothing to do
}
