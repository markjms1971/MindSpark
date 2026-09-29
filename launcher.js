#!/usr/bin/env node
/**
 * MindSpark Launcher - entry point for the standalone executable.
 *
 * This wrapper:
 *  1. Starts the MindSpark HTTP server (server.js)
 *  2. Automatically opens the user's default browser to the app URL
 *  3. Handles graceful shutdown on Ctrl+C / SIGTERM
 *
 * When packaged with `pkg`, static assets in public/ are bundled inside the
 * executable via the snapshot filesystem. The database file (data/mindspark.db)
 * is created in the working directory at runtime.
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// ---- Configuration -------------------------------------------------------
const PORT = process.env.PORT || 3000;
const OPEN_BROWSER = process.env.NO_BROWSER !== '1';

// ---- Open browser (cross-platform) --------------------------------------
// Detached and unref'd: the opener must never block this process, which IS the
// HTTP server. execSync used to wait for it - and an opener that does not return
// at once (sensible-browser falling back to a terminal browser, some xdg setups)
// froze the server the browser was trying to load.
function openBrowser(url) {
  const platform = os.platform();
  const run = (cmd, args, next) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => { if (next) next(); });
      child.unref();
    } catch {
      if (next) next();
    }
  };
  if (platform === 'win32') run('cmd', ['/c', 'start', '', url]);   // '' = the window-title slot start expects
  else if (platform === 'darwin') run('open', [url]);
  else run('xdg-open', [url], () => run('sensible-browser', [url]));   // Linux / other
}

// ---- Start the server ----------------------------------------------------
console.log(`
  ╔══════════════════════════════════════════════════╗
  ║           MindSpark - Desktop Edition            ║
  ╚══════════════════════════════════════════════════╝
`);

// When running as a pkg executable, __dirname points to the snapshot.
// server.js uses __dirname to find PUBLIC and DB_PATH, which works correctly
// for PUBLIC (inside snapshot). For DB_PATH we override to use real filesystem.
const isPkg = typeof process.pkg !== 'undefined';

if (isPkg) {
  // Inside pkg, __dirname is the snapshot path (e.g. /snapshot/mindspark/).
  // MS_PUBLIC, not PUBLIC: Windows sets PUBLIC (C:\Users\Public) for every
  // process, so `process.env.PUBLIC || ...` never took effect there.
  process.env.MS_PUBLIC = process.env.MS_PUBLIC || path.join(__dirname, 'public');

  // Database should be in the real filesystem (next to the exe), not inside the snapshot.
  if (!process.env.DB_PATH) {
    const exeDir = path.dirname(process.execPath);
    process.env.DB_PATH = path.join(exeDir, 'data', 'mindspark.db');
  }
}

process.env.PORT = String(PORT);

const serverUrl = `http://localhost:${PORT}`;

try {
  // Requiring it starts it (server.listen()); open the browser once it listens -
  // not after a fixed delay, and never when the port turned out to be taken.
  const server = require('./server.js');
  if (OPEN_BROWSER) {
    server.once('listening', () => {
      console.log(`  Opening browser → ${serverUrl}\n`);
      openBrowser(serverUrl);
    });
  }
} catch (err) {
  console.error('\n  Failed to start MindSpark server:\n');
  console.error(' ', err.message || err);
  console.error('\n  If you see a "node:sqlite" error, make sure this executable');
  console.error('  was built with Node.js >= 22 which includes built-in SQLite.\n');
  process.exit(1);
}

// ---- Graceful shutdown ---------------------------------------------------
function shutdown() {
  console.log('\n  Shutting down MindSpark...');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
