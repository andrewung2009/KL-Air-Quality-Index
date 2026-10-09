'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const EXE_NAME = 'KL AQI.exe';
const PAYLOAD_DIR = path.join(root, 'payload');
const DIST_DIR = path.join(root, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'KL-AQI.exe');
const ELECTRON_DIST = path.join(root, 'node_modules', 'electron', 'dist');
const NSIS_SCRIPT = path.join(root, 'packaging', 'installer.nsi');
const ICON_FILE = path.join(root, 'icon.ico');

const APP_FILES = [
  'package.json',
  'main.js',
  'preload.js',
  'renderer.js',
  'settings.js',
  'fetcher.js',
  'defaults.js',
  'index.html',
  'settings.html',
  'styles.css',
  'settings.css',
  'config.json',
  'tray.png'
];

const MAKENSIS_CANDIDATES = [
  process.env.MAKENSIS,
  'makensis.exe',
  'C:\\Program Files (x86)\\NSIS\\makensis.exe',
  'C:\\Program Files\\NSIS\\makensis.exe'
].filter(Boolean);

function findMakensis() {
  for (const candidate of MAKENSIS_CANDIDATES) {
    try {
      execFileSync(candidate, ['/VERSION'], { stdio: 'pipe' });
      return candidate;
    } catch (err) {
      // try next candidate
    }
  }
  return null;
}

function stagePayload() {
  if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
    throw new Error(
      'Electron runtime missing at node_modules/electron/dist - run "npm install" first (postinstall downloads it)'
    );
  }
  fs.rmSync(PAYLOAD_DIR, { recursive: true, force: true });
  fs.cpSync(ELECTRON_DIST, PAYLOAD_DIR, { recursive: true });

  const defaultApp = path.join(PAYLOAD_DIR, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);

  const appDir = path.join(PAYLOAD_DIR, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of APP_FILES) {
    const src = path.join(root, file);
    if (!fs.existsSync(src)) throw new Error('missing app file: ' + file);
    fs.copyFileSync(src, path.join(appDir, file));
  }

  fs.renameSync(path.join(PAYLOAD_DIR, 'electron.exe'), path.join(PAYLOAD_DIR, EXE_NAME));
  const bytes = fs
    .readdirSync(path.join(PAYLOAD_DIR, 'resources', 'app'))
    .reduce((total, file) => total + fs.statSync(path.join(appDir, file)).size, 0);
  console.log('staged payload -> ' + PAYLOAD_DIR + ' (app files: ' + APP_FILES.length + ', ' + bytes + ' bytes)');
}

function buildInstaller() {
  const makensis = findMakensis();
  if (!makensis) {
    throw new Error(
      'makensis not found - install NSIS (winget install NSIS.NSIS) or set the MAKENSIS env var'
    );
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.rmSync(OUT_FILE, { force: true });

  const args = [
    '/DPAYLOAD_DIR=' + PAYLOAD_DIR,
    '/DICON_FILE=' + ICON_FILE,
    '/DOUT_FILE=' + OUT_FILE,
    '/DVERSION=' + version,
    NSIS_SCRIPT
  ];
  console.log('makensis ' + args.join(' '));
  execFileSync(makensis, args, { stdio: 'inherit', cwd: path.join(root, 'packaging') });

  if (!fs.existsSync(OUT_FILE)) throw new Error('installer was not produced');
  return OUT_FILE;
}

function main() {
  stagePayload();
  const out = buildInstaller();
  const size = fs.statSync(out).size;
  console.log('built ' + out + ' (' + size + ' bytes, version ' + version + ')');
}

try {
  main();
} catch (err) {
  console.error('build failed:', err.message);
  process.exit(1);
}
