const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const execAsync = promisify(exec);
const router = express.Router();

async function getScreenSize() {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const script = `osascript -e 'tell application "Finder" to get bounds of window of desktop'`;
      const { stdout } = await execAsync(script);
      const parts = stdout.trim().split(',').map(Number);
      return { width: parts[2] - parts[0], height: parts[3] - parts[1] };
    } else if (platform === 'linux') {
      const { stdout } = await execAsync('xdpyinfo | grep dimensions');
      const match = stdout.match(/(\d+)x(\d+)/);
      return match ? { width: parseInt(match[1]), height: parseInt(match[2]) } : { width: 1920, height: 1080 };
    } else if (platform === 'win32') {
      const ps = `powershell -Command "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select-Object Width, Height | ConvertTo-Json"`;
      const { stdout } = await execAsync(ps);
      const data = JSON.parse(stdout);
      return { width: data.Width || 1920, height: data.Height || 1080 };
    }
  } catch {}

  return { width: 1920, height: 1080 };
}

const WIN_GET_WINDOWS_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    static List<uint> _targetPids = new List<uint>();
    static List<string> _results = new List<string>();
    static HashSet<string> _seen = new HashSet<string>();

    static bool Callback(IntPtr hWnd, IntPtr lParam) {
        if (!IsWindowVisible(hWnd)) return true;
        int len = GetWindowTextLength(hWnd);
        if (len <= 0) return true;

        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        string title = sb.ToString();

        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);

        bool isMatch = false;
        if (_targetPids.Count > 0 && _targetPids.Contains(pid)) {
            isMatch = true;
        } else if (title.IndexOf("Cloak", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("chrome", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("chromium", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("MultiManager", StringComparison.OrdinalIgnoreCase) >= 0) {
            isMatch = true;
        }

        if (isMatch) {
            string handle = hWnd.ToInt64().ToString();
            if (!_seen.Contains(handle)) {
                _seen.Add(handle);
                RECT rect = new RECT();
                GetWindowRect(hWnd, out rect);
                string line = handle + "|" + pid + "|" + title + "|" + rect.Left + "|" + rect.Top + "|" + (rect.Right - rect.Left) + "|" + (rect.Bottom - rect.Top);
                _results.Add(line);
            }
        }
        return true;
    }

    public static string FindWindows(string[] pids) {
        _targetPids.Clear();
        _results.Clear();
        _seen.Clear();
        foreach (string p in pids) {
            uint val;
            if (uint.TryParse(p, out val)) _targetPids.Add(val);
        }
        EnumWindows(Callback, IntPtr.Zero);
        return string.Join("\\n", _results);
    }
}
"@

$pids = @(@@TARGETPIDS@@)
[WinHelper]::FindWindows($pids)
`;

async function getRunningWindows() {
  const platform = process.platform;
  let windows = [];

  try {
    let targetPids = [];
    try {
      const db = getDatabase();
      const profileQueries = createProfileQueries(db);
      const profiles = profileQueries.getAll();
      targetPids = profiles
        .filter(p => p.pid && p.status === 'running')
        .map(p => p.pid);
      logger.info({ targetPids, runningCount: profiles.filter(p => p.status === 'running').length }, 'Window arranger: profiles query');
    } catch (err) {
      logger.error({ err: err.message }, 'Window arranger: failed to query profiles');
    }

    if (platform === 'linux') {
      const { stdout } = await execAsync("xdotool search --name '' 2>/dev/null | head -20");
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
            x: get('X'), y: get('Y'),
            width: get('WIDTH'), height: get('HEIGHT'),
          });
        } catch {}
      }
    } else if (platform === 'win32') {
      const psWithPids = WIN_GET_WINDOWS_PS.replace(
        '@@TARGETPIDS@@',
        targetPids.map(p => `'${p}'`).join(',')
      );
      const tmpFile = path.join(require('os').tmpdir(), 'mm_windows.ps1');
      fs.writeFileSync(tmpFile, psWithPids, 'utf-8');
      try {
        const { stdout, stderr } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`);
        logger.info({ stdoutLen: stdout.length, stderr: stderr || '', targetPids }, 'Window arranger: PowerShell result');
        if (stdout.trim()) {
          const lines = stdout.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 7) {
              windows.push({
                id: parts[0],
                name: parts[2],
                x: parseInt(parts[3]) || 0,
                y: parseInt(parts[4]) || 0,
                width: parseInt(parts[5]) || 800,
                height: parseInt(parts[6]) || 600,
              });
            }
          }
        }
      } catch (err) {
        logger.error({ err: err.message }, 'Window arranger: PowerShell failed');
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } else if (platform === 'darwin') {
      const script = `
        set output to ""
        tell application "System Events"
          repeat with proc in (every process whose visible is true)
            set procName to name of proc
            repeat with win in (every window of proc)
              set winPos to position of win
              set winSize to size of win
              set output to output & procName & "|" & name of win & "|" & (item 1 of winPos) & "|" & (item 2 of winPos) & "|" & (item 1 of winSize) & "|" & (item 2 of winSize) & linefeed
            end repeat
          end repeat
        end tell
        return output
      `.replace(/\n/g, ' ');

      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 6) {
          windows.push({
            id: parts[0],
            name: `${parts[0]} - ${parts[1]}`,
            x: parseInt(parts[2]) || 0,
            y: parseInt(parts[3]) || 0,
            width: parseInt(parts[4]) || 800,
            height: parseInt(parts[5]) || 600,
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error getting windows');
  }

  logger.info({ windowCount: windows.length }, 'Window arranger: result');
  return windows;
}

async function moveWindow(windowId, x, y, width, height) {
  const platform = process.platform;

  try {
    if (platform === 'linux') {
      await execAsync(`xdotool windowmove ${windowId} ${x} ${y}`);
      await execAsync(`xdotool windowsize ${windowId} ${width} ${height}`);
    } else if (platform === 'win32') {
      const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool r);
}
"@
[WinAPI]::MoveWindow([IntPtr]${parseInt(windowId)}, ${x}, ${y}, ${width}, ${height}, $true)
`;
      await execAsync(ps);
    } else if (platform === 'darwin') {
      const safeWindowId = windowId.replace(/"/g, '\\"');
      const positionScript = `tell application "System Events" to set position of window 1 of process "${safeWindowId}" to {${x}, ${y}}`;
      await execAsync(`osascript -e '${positionScript}'`);

      const sizeScript = `tell application "System Events" to set size of window 1 of process "${safeWindowId}" to {${width}, ${height}}`;
      await execAsync(`osascript -e '${sizeScript}'`);
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error moving window');
  }
}

async function focusWindow(windowId) {
  const platform = process.platform;

  try {
    if (platform === 'linux') {
      await execAsync(`xdotool windowactivate ${windowId}`);
    } else if (platform === 'darwin') {
      const safeWindowId = windowId.replace(/"/g, '\\"');
      const script = `tell application "${safeWindowId}" to activate`;
      await execAsync(`osascript -e '${script}'`);
    } else if (platform === 'win32') {
      const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[WinAPI]::SetForegroundWindow([IntPtr]${parseInt(windowId)})
`;
      await execAsync(ps);
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error focusing window');
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

router.get('/windows/grouped', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    const db = getDatabase();
    const profileQueries = createProfileQueries(db);

    const profileWindowsMap = new Map();
    const ungrouped = [];

    for (const win of windows) {
      const profile = profileQueries.getAll().find(p => p.pid && String(p.pid) === String(win.pid));
      if (profile) {
        if (!profileWindowsMap.has(profile.id)) {
          profileWindowsMap.set(profile.id, {
            profileId: profile.id,
            profileName: profile.name,
            profileNumber: profile.number,
            windows: [],
          });
        }
        profileWindowsMap.get(profile.id).windows.push(win);
      } else {
        ungrouped.push(win);
      }
    }

    const groups = Array.from(profileWindowsMap.values());
    if (ungrouped.length > 0) {
      groups.push({
        profileId: null,
        profileName: 'Other',
        profileNumber: 0,
        windows: ungrouped,
      });
    }

    res.json(groups);
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

    const screen = await getScreenSize();
    const cols = Math.ceil(Math.sqrt(windows.length));
    const rows = Math.ceil(windows.length / cols);
    const cellWidth = Math.floor(screen.width / cols);
    const cellHeight = Math.floor(screen.height / rows);

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      await moveWindow(windows[i].id, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
      arranged++;
    }

    res.json({ arranged, cols, rows, screen });
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
    const width = 1200;
    const height = 800;

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      await moveWindow(windows[i].id, 100 + (i * offset), 100 + (i * offset), width, height);
      arranged++;
    }

    res.json({ arranged, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/grid/grouped', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    if (windows.length === 0) {
      return res.json({ arranged: 0 });
    }

    const db = getDatabase();
    const profileQueries = createProfileQueries(db);
    const screen = await getScreenSize();

    const profileWindowsMap = new Map();
    const ungrouped = [];

    for (const win of windows) {
      const profile = profileQueries.getAll().find(p => p.pid && String(p.pid) === String(win.pid));
      if (profile) {
        if (!profileWindowsMap.has(profile.id)) {
          profileWindowsMap.set(profile.id, []);
        }
        profileWindowsMap.get(profile.id).push(win);
      } else {
        ungrouped.push(win);
      }
    }

    const groups = Array.from(profileWindowsMap.values());
    if (ungrouped.length > 0) {
      groups.push(ungrouped);
    }

    const groupCount = groups.length;
    const groupCols = Math.ceil(Math.sqrt(groupCount));
    const groupRows = Math.ceil(groupCount / groupCols);
    const groupWidth = Math.floor(screen.width / groupCols);
    const groupHeight = Math.floor(screen.height / groupRows);

    let arranged = 0;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const gCol = g % groupCols;
      const gRow = Math.floor(g / groupCols);
      const gX = gCol * groupWidth;
      const gY = gRow * groupHeight;

      const wCols = Math.ceil(Math.sqrt(group.length));
      const wRows = Math.ceil(group.length / wCols);
      const wWidth = Math.floor(groupWidth / wCols);
      const wHeight = Math.floor(groupHeight / wRows);

      for (let i = 0; i < group.length; i++) {
        const wCol = i % wCols;
        const wRow = Math.floor(i / wCols);
        await moveWindow(
          group[i].id,
          gX + wCol * wWidth,
          gY + wRow * wHeight,
          wWidth,
          wHeight
        );
        arranged++;
      }
    }

    res.json({ arranged, groups: groupCount, screen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cascade/grouped', async (req, res) => {
  try {
    const windows = await getRunningWindows();
    if (windows.length === 0) {
      return res.json({ arranged: 0 });
    }

    const db = getDatabase();
    const profileQueries = createProfileQueries(db);

    const profileWindowsMap = new Map();
    const ungrouped = [];

    for (const win of windows) {
      const profile = profileQueries.getAll().find(p => p.pid && String(p.pid) === String(win.pid));
      if (profile) {
        if (!profileWindowsMap.has(profile.id)) {
          profileWindowsMap.set(profile.id, []);
        }
        profileWindowsMap.get(profile.id).push(win);
      } else {
        ungrouped.push(win);
      }
    }

    const groups = Array.from(profileWindowsMap.values());
    if (ungrouped.length > 0) {
      groups.push(ungrouped);
    }

    const offset = 30;
    const width = 1200;
    const height = 800;
    let globalOffset = 0;

    let arranged = 0;
    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        await moveWindow(
          group[i].id,
          100 + (globalOffset * offset),
          100 + (globalOffset * offset),
          width,
          height
        );
        globalOffset++;
        arranged++;
      }
    }

    res.json({ arranged, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/focus/:windowId', async (req, res) => {
  try {
    await focusWindow(req.params.windowId);
    res.json({ focused: req.params.windowId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
