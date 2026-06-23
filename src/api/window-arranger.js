const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const { getDatabase, createProfileQueries } = require('../db');

const execAsync = promisify(exec);
const router = express.Router();

async function getRunningWindows() {
  const platform = process.platform;
  let windows = [];

  try {
    if (platform === 'linux') {
      const { stdout } = await execAsync(
        "xdotool search --name '' 2>/dev/null | head -20"
      );
      const pids = stdout.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        try {
          const { stdout: name } = await execAsync(`xdotool getwindowname ${pid} 2>/dev/null`);
          const { stdout: geom } = await execAsync(`xdotool getwindowgeometry --shell ${pid} 2>/dev/null`);
          const lines = geom.trim().split('\n');
          const get = (key) => {
            const line = lines.find(l => l.startsWith(key));
            return line ? parseInt(line.split('=')[1]) : 0;
          };
          windows.push({
            id: pid,
            name: name.trim(),
            x: get('X'),
            y: get('Y'),
            width: get('WIDTH'),
            height: get('HEIGHT'),
          });
        } catch {}
      }
    } else if (platform === 'win32') {
      const ps = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Id, MainWindowTitle, MainWindowHandle | ConvertTo-Json"`;
      const { stdout } = await execAsync(ps);
      const procs = JSON.parse(stdout);
      for (const proc of (Array.isArray(procs) ? procs : [procs])) {
        windows.push({
          id: String(proc.Id),
          name: proc.MainWindowTitle,
          x: 0, y: 0, width: 1920, height: 1080,
        });
      }
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get {name, position, size} of every window of every process whose visible is true'`
      );
      // Parse AppleScript output
    }
  } catch (err) {
    console.error('Error getting windows:', err.message);
  }

  return windows;
}

async function moveWindow(windowId, x, y, width, height) {
  const platform = process.platform;

  try {
    if (platform === 'linux') {
      await execAsync(`xdotool windowmove ${windowId} ${x} ${y}`);
      await execAsync(`xdotool windowsize ${windowId} ${width} ${height}`);
    } else if (platform === 'win32') {
      const ps = `powershell -Command "
        Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        public class WinAPI {
          [DllImport(\\"user32.dll\\")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool r);
        }
'@
        [WinAPI]::MoveWindow([IntPtr]${parseInt(windowId)}, ${x}, ${y}, ${width}, ${height}, $true)
      "`;
      await execAsync(ps);
    }
  } catch (err) {
    console.error('Error moving window:', err.message);
  }
}

router.get('/windows', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    res.json(windows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/grid', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    if (windows.length === 0) {
      return res.json({ arranged: 0 });
    }

    const cols = Math.ceil(Math.sqrt(windows.length));
    const rows = Math.ceil(windows.length / cols);

    const screenWidth = 1920;
    const screenHeight = 1080;
    const cellWidth = Math.floor(screenWidth / cols);
    const cellHeight = Math.floor(screenHeight / rows);

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellWidth;
      const y = row * cellHeight;

      await moveWindow(windows[i].id, x, y, cellWidth, cellHeight);
      arranged++;
    }

    res.json({ arranged, cols, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cascade', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    if (windows.length === 0) {
      return res.json({ arranged: 0 });
    }

    const offset = 30;
    const startX = 100;
    const startY = 100;
    const width = 1200;
    const height = 800;

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      const x = startX + (i * offset);
      const y = startY + (i * offset);

      await moveWindow(windows[i].id, x, y, width, height);
      arranged++;
    }

    res.json({ arranged, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/focus/:windowId', async (req, res) => {
  try {
    const platform = process.platform;
    if (platform === 'linux') {
      await execAsync(`xdotool windowactivate ${req.params.windowId}`);
    }
    res.json({ focused: req.params.windowId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
