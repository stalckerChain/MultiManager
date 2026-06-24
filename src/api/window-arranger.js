const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
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
public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$results = @()
[WinEnum]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinEnum]::IsWindowVisible($hWnd)) {
        $len = [WinEnum]::GetWindowTextLength($hWnd)
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [WinEnum]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -match 'Cloak|chromium|chrome|Chromium|CloakBrowser') {
                $pid = 0
                [WinEnum]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
                $rect = New-Object WinEnum+RECT
                [WinEnum]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
                $results += @{
                    handle = [string]$hWnd.ToInt64()
                    pid = [string]$pid
                    name = $title
                    x = $rect.Left
                    y = $rect.Top
                    width = $rect.Right - $rect.Left
                    height = $rect.Bottom - $rect.Top
                }
            }
        }
    }
    return $true
})
$results | ConvertTo-Json -Compress
`;

async function getRunningWindows() {
  const platform = process.platform;
  let windows = [];

  try {
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
      const { stdout } = await execAsync(WIN_GET_WINDOWS_PS);
      if (stdout.trim()) {
        const procs = JSON.parse(stdout);
        for (const proc of (Array.isArray(procs) ? procs : [procs])) {
          windows.push({
            id: proc.handle,
            name: proc.name,
            x: proc.x || 0,
            y: proc.y || 0,
            width: proc.width || 800,
            height: proc.height || 600,
          });
        }
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

router.post('/focus/:windowId', async (req, res) => {
  try {
    await focusWindow(req.params.windowId);
    res.json({ focused: req.params.windowId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
