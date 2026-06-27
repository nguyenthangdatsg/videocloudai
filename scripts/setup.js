#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg) { console.log(`${CYAN}[setup]${RESET} ${msg}`); }
function ok(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }

// Create required directories
const dirs = [
  'assets/videos', 'assets/images', 'assets/audio', 'assets/subtitles', 'assets/music',
  'cache/generations', 'cache/prompts', 'cache/narration',
  'database', 'renders',
];

log('Creating directories...');
dirs.forEach((dir) => {
  const full = path.join(ROOT, dir);
  fs.mkdirSync(full, { recursive: true });
});
ok('Directories created');

// Copy .env if not exists
const envSrc = path.join(ROOT, '.env.example');
const envDst = path.join(ROOT, '.env');
if (!fs.existsSync(envDst) && fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, envDst);
  ok('.env created from .env.example');
} else if (fs.existsSync(envDst)) {
  ok('.env already exists');
}

// Check Node version
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1));
if (major < 20) {
  warn(`Node.js ${nodeVersion} detected. Node 20+ recommended.`);
} else {
  ok(`Node.js ${nodeVersion}`);
}

// Check FFmpeg
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ok('FFmpeg found in PATH');
} catch {
  warn('FFmpeg NOT found. Install from https://ffmpeg.org/download.html');
}

// Check Python dependencies
try {
  execSync('python --version', { stdio: 'ignore' });
  ok('Python found');
} catch {
  warn('Python not found. Required for edge-tts and whisper.');
}

try {
  execSync('edge-tts --version', { stdio: 'ignore' });
  ok('edge-tts found');
} catch {
  warn('edge-tts not installed. Run: pip install edge-tts');
}

try {
  execSync('whisper --help', { stdio: 'ignore' });
  ok('Whisper found');
} catch {
  warn('Whisper not installed. Run: pip install openai-whisper');
}

console.log('\n' + GREEN + '═══════════════════════════════════════' + RESET);
console.log(GREEN + '  VideoCloudAI setup complete!' + RESET);
console.log(GREEN + '═══════════════════════════════════════' + RESET);
console.log('\nNext steps:');
console.log('  1. Edit .env and add your API keys');
console.log('  2. npm install');
console.log('  3. npm run dev');
console.log('\nFrontend: http://localhost:5173');
console.log('Backend:  http://localhost:3001\n');
