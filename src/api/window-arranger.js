const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const execAsync = promisify(exec);

function toPSEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

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
      const ps = `powershell -Command "[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea | Select-Object Width, Height, X, Y | ConvertTo-Json"`;
      const { stdout } = await execAsync(ps);
      const data = JSON.parse(stdout);
      return { width: data.Width || 1920, height: data.Height || 1080, x: data.X || 0, y: data.Y || 0 };
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
    static bool _pidOnly = false;

    static bool Callback(IntPtr hWnd, IntPtr lParam) {
        if (!IsWindowVisible(hWnd)) return true;
        int len = GetWindowTextLength(hWnd);
        if (len <= 0) return true;

        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);

        bool isMatch = false;
        if (_targetPids.Count > 0 && _targetPids.Contains(pid)) {
            isMatch = true;
        } else if (!_pidOnly) {
            StringBuilder sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (title.IndexOf("Cloak", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("chrome", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("chromium", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("MultiManager", StringComparison.OrdinalIgnoreCase) >= 0) {
                isMatch = true;
            }
        }

        if (isMatch) {
            StringBuilder sb2 = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb2, sb2.Capacity);
            string title = sb2.ToString();
            string lowerTitle = title.ToLowerInvariant();
            if (lowerTitle.Contains("restore") || lowerTitle.Contains("восстановить")
                || lowerTitle.Contains("crashed") || lowerTitle.Contains("не заверш")
                || lowerTitle.Contains("некорректно")) {
                return true;
            }
            RECT rect = new RECT();
            GetWindowRect(hWnd, out rect);
            int w = rect.Right - rect.Left;
            int h = rect.Bottom - rect.Top;
            if (w < 300 || h < 200) {
                return true;
            }
            string handle = hWnd.ToInt64().ToString();
            if (!_seen.Contains(handle)) {
                _seen.Add(handle);
                string line = handle + "|" + pid + "|" + title + "|" + rect.Left + "|" + rect.Top + "|" + w + "|" + h;
                _results.Add(line);
            }
        }
        return true;
    }

    public static string FindWindows(string[] pids, bool pidOnly) {
        _targetPids.Clear();
        _results.Clear();
        _seen.Clear();
        _pidOnly = pidOnly;
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
$pidOnly = @(@@PIDONLY@@)
[WinHelper]::FindWindows($pids, $pidOnly)
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
      const pidOnly = targetPids.length > 0;
      const psWithPids = WIN_GET_WINDOWS_PS
        .replace('@@TARGETPIDS@@', targetPids.map(p => `'${p}'`).join(','))
        .replace('@@PIDONLY@@', pidOnly ? '$true' : '$false');
      try {
        const { stdout, stderr } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${toPSEncoded(psWithPids)}`);
        logger.info({ stdoutLen: stdout.length, stderr: stderr || '', targetPids, pidOnly }, 'Window arranger: PowerShell result');
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
      const handle = parseInt(windowId);
      if (!handle) return;
      const ps = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool r);
}
"@
[WinAPI]::MoveWindow([IntPtr]${handle}, ${x}, ${y}, ${width}, ${height}, $true)
`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${toPSEncoded(ps)}`);
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
      const handle = parseInt(windowId);
      if (!handle) return;
      const ps = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[WinAPI]::SetForegroundWindow([IntPtr]${handle})
`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${toPSEncoded(ps)}`);
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
    const offsetX = screen.x || 0;
    const offsetY = screen.y || 0;

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      await moveWindow(windows[i].id, offsetX + col * cellWidth, offsetY + row * cellHeight, cellWidth, cellHeight);
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

    const screen = await getScreenSize();
    const offset = 30;
    const width = Math.min(1200, screen.width - 200);
    const height = Math.min(800, screen.height - 200);
    const startX = (screen.x || 0) + 100;
    const startY = (screen.y || 0) + 100;

    let arranged = 0;
    for (let i = 0; i < windows.length; i++) {
      await moveWindow(windows[i].id, startX + (i * offset), startY + (i * offset), width, height);
      arranged++;
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
