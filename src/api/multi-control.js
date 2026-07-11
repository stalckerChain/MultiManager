const express = require('express');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { controller } = require('../multi-control');
const { cdpManager } = require('../multi-control/cdp-manager');
const { inputCapture, windowTracker } = require('../os-input');
const { getCdpPort } = require('./browser');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const execAsync = promisify(exec);

// PowerShell через spawn + -EncodedCommand — см. подробный комментарий
// в window-arranger.js. Кратко: Add-Type + here-string ломается при чтении
// скрипта из stdin (`-Command -`), а execAsync упирается в лимит длины
// командной строки cmd.exe (~8191 символов) для больших encoded-скриптов.
function toPSEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', toPSEncoded(script),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PowerShell exited with code ${code}: ${stderr || 'unknown error'}`));
    });
  });
}

const router = express.Router();

controller.cdp = cdpManager;

const pendingSync = new Set();
const attachedMasterTabs = new Set();

/**
 * Синхронизация нового таба мастера в слейвы.
 *
 * Для каждого слейва: создаёт таб через CDP, немедленно attach'ит его (антидетект
 * не шлёт Target.attachedToTarget), маппит и активирует. Также attach'ит таб в самом
 * мастере и переводит activeMasterTab на него (вновь открытый таб = активный).
 *
 * @param {string} masterTargetId - targetId нового таба мастера
 * @param {string} masterTabUrl - URL нового таба (для создания аналогичных в слейвах)
 */
async function syncNewMasterTab(masterTargetId, masterTabUrl) {
  if (!controller.active || !controller.masterId) return;
  if (pendingSync.has(masterTargetId)) return;
  pendingSync.add(masterTargetId);

  try {
    // Attach таб мастера (если ещё не подключён), чтобы на нём работал ввод
    if (!attachedMasterTabs.has(masterTargetId)) {
      const masterBc = cdpManager.browserConnections.get(controller.masterId);
      if (masterBc && !masterBc.targetSessions.has(masterTargetId)) {
        await cdpManager.attachToExistingTarget(controller.masterId, masterTargetId);
      }
      attachedMasterTabs.add(masterTargetId);
    }

    logger.info({ masterTargetId, url: masterTabUrl }, 'SYNC: discovered new master tab, syncing slaves');
    for (const [slaveId] of controller.slaves) {
      try {
        let nativeTab = await _findNativeSlaveTab(slaveId);
        if (nativeTab) {
          await cdpManager.attachToExistingTarget(slaveId, nativeTab.targetId);
          controller.mapTab(masterTargetId, slaveId, nativeTab.targetId);
          if (masterTargetId !== controller.activeMasterTab) {
            await controller._enforceSlaveFocusOnActiveTab(slaveId);
          }
          logger.info({ slaveId, slaveTargetId: nativeTab.targetId }, 'SYNC: mapped existing native slave tab');
        } else {
          const slaveTargetId = await cdpManager.createTab(slaveId, masterTabUrl);
          if (slaveTargetId) {
            await cdpManager.attachToExistingTarget(slaveId, slaveTargetId);
            controller.mapTab(masterTargetId, slaveId, slaveTargetId);
            if (masterTargetId !== controller.activeMasterTab) {
              await controller._enforceSlaveFocusOnActiveTab(slaveId);
            }
            logger.info({ slaveId, slaveTargetId }, 'SYNC: created and mapped slave tab');
          }
        }
      } catch (err) {
        logger.error({ slaveId, error: err.message }, 'SYNC: failed to sync slave tab');
      }
    }
  } finally {
    pendingSync.delete(masterTargetId);
  }
}

/**
 * Поиск нативного таба в слейве, открытого от диспатченного ивента.
 *
 * В отличие от старой логики (сравнение /json с targetSessions), этот метод
 * сравнивает /json с уже замапленными в tabMapping табами слейва. Это
 * исключает race condition с CDP auto-attach: нативный таб может быть уже
 * в targetSessions, но его ещё нет в tabMapping — значит, это наш кандидат.
 *
 * Делает 2 попытки с паузой 150мс, т.к. браузер может не успеть открыть таб.
 *
 * @param {string} slaveId
 * @returns {Promise<{targetId: string, url: string}|null>}
 */
async function _findNativeSlaveTab(slaveId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const slaveTabs = await cdpManager.getHttpTabs(slaveId);
    const mappedIds = _getMappedSlaveTabIds(slaveId);
    const candidate = slaveTabs.find(t => t.type === 'page' && !mappedIds.has(t.targetId));
    if (candidate) return candidate;
    if (attempt === 0) await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

function _getMappedSlaveTabIds(slaveId) {
  const ids = new Set();
  for (const [, bySlave] of controller.tabMapping) {
    const tid = bySlave.get(slaveId);
    if (tid) ids.add(tid);
  }
  return ids;
}

let discovering = false;

/**
 * Обнаружение новых табов мастера через HTTP /json.
 *
 * Антидетект НЕ шлёт Target.targetCreated для нативно открытых табов через WS,
 * поэтому единственный надёжный источник — HTTP DevTools endpoint. Сравниваем
 * список табов из /json с уже подключёнными (targetSessions) мастера. Вновь
 * появившийся page-таб = новый активный таб (браузер автофокусирует его).
 */
async function discoverActiveTab() {
  if (!controller.active || !controller.masterId || discovering) return;
  discovering = true;
  try {
    const tabs = await cdpManager.getHttpTabs(controller.masterId);
    if (tabs.length === 0) return;

    const masterBc = cdpManager.browserConnections.get(controller.masterId);
    const knownTargets = masterBc ? masterBc.targetSessions : null;

    // Новый таб = его ещё нет в targetSessions мастера
    const newTab = knownTargets
      ? tabs.find(t => !knownTargets.has(t.targetId))
      : tabs[0];

    if (newTab) {
      await syncNewMasterTab(newTab.targetId, newTab.url);
    }
  } catch (err) {
    logger.warn({ error: err.message }, 'DISCOVERY: getHttpTabs failed');
  } finally {
    discovering = false;
  }
}

function wireInputToController() {
  inputCapture.on('mouseMove', (event) => {
    if (!controller.active) return;
    controller.onMouseMoved(event);
  });

  inputCapture.on('mouseDown', (event) => {
    if (!controller.active) return;
    controller.onMousePressed(event);
  });

  inputCapture.on('mouseUp', (event) => {
    if (!controller.active) return;
    controller.onMouseReleased(event);
  });

  inputCapture.on('scroll', (event) => {
    if (!controller.active) return;
    controller.scrollTo(event);
  });

  inputCapture.on('keyDown', (event) => {
    if (!controller.active) return;
    controller.onKeyDown(event);
  });

  inputCapture.on('keyUp', (event) => {
    if (!controller.active) return;
    controller.onKeyUp(event);
  });

  inputCapture.on('charInput', (event) => {
    if (!controller.active) return;
    controller.onCharInput(event);
  });

  logger.info('MULTI-CONTROL: Input wired to controller');
}

router.get('/status', (req, res) => {
  res.json(controller.getStatus());
});

router.post('/start', async (req, res) => {
  const { masterId } = req.body;

  if (!masterId) {
    return res.status(400).json({ error: 'Поле masterId обязательно' });
  }

  const port = getCdpPort(masterId);
  if (!port) {
    return res.status(412).json({ error: 'CDP порт недоступен. Убедитесь, что профиль запущен.' });
  }

  try {
    cdpManager.onEvent = (profileId, event, sessionId) => {
      if (profileId === masterId && controller.active) {
        if (event.type === 'tabActivated') {
          const targetId = cdpManager.targetBySid.get(sessionId);
          if (targetId) {
            controller.setActiveMasterTab(targetId);
          }
          return;
        }
        const targetId = cdpManager.targetBySid.get(sessionId);
        if (targetId && !['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'].includes(event.type)) {
          controller.setActiveMasterTab(targetId);
        }
        inputCapture.injectFromCdp(event);
      }
    };

    cdpManager.onNewTab = async (profileId, targetInfo, newSession) => {
      if (!controller.active) return;

      if (profileId === masterId) {
        attachedMasterTabs.add(targetInfo.targetId);
        logger.info({ masterTargetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: master new tab tracked, waiting for activation');
        return;
      }

      const bc = cdpManager.browserConnections.get(profileId);
      if (bc) {
        const slaveIdx = bc.targetSessions.size - 1;
        const masterTargetId = controller.tabIndex[slaveIdx];
        if (masterTargetId) {
          controller.mapTab(masterTargetId, profileId, targetInfo.targetId);
          logger.info({ slaveId: profileId, masterTargetId, slaveTargetId: targetInfo.targetId, tabIndex: slaveIdx }, 'MULTI-CONTROL: mapped slave tab by tabIndex order');
        } else {
          logger.info({ profileId, targetId: targetInfo.targetId, url: targetInfo.url, slaveIdx }, 'MULTI-CONTROL: slave opened new tab (no matching master tab in tabIndex)');
        }
      }
    };

    cdpManager.onTabAttached = (profileId, targetInfo, newSession) => {
      if (!controller.active) return;
      if (profileId === masterId) return;

      const bc = cdpManager.browserConnections.get(profileId);
      if (bc) {
        const slaveIdx = bc.targetSessions.size - 1;
        const masterTargetId = controller.tabIndex[slaveIdx];
        if (masterTargetId && masterTargetId !== controller.activeMasterTab) {
          controller._enforceSlaveFocusOnActiveTab(profileId).catch(err => {
            logger.error({ slaveId: profileId, error: err.message }, 'MULTI-CONTROL: _enforceSlaveFocusOnActiveTab failed after attach');
          });
          logger.info({ slaveId: profileId, masterTargetId, slaveTargetId: targetInfo.targetId }, 'MULTI-CONTROL: enforced focus on active tab after attach');
        }
      }
    };

    cdpManager.onNavigate = (profileId, navUrl, sessionId) => {
      if (profileId === masterId && controller.active) {
        logger.info({ masterId, url: navUrl, sessionId }, 'MULTI-CONTROL: master navigated, syncing to slaves');

        if (sessionId) {
          const masterTargetId = cdpManager.targetBySid.get(sessionId);
          if (masterTargetId) {
            controller.setActiveMasterTab(masterTargetId);
            let navigatedMapped = false;
            for (const [slaveId] of controller.slaves) {
              const slaveTargetId = controller.getSlaveTabForMaster(masterTargetId, slaveId);
              if (slaveTargetId) {
                const bc = cdpManager.browserConnections.get(slaveId);
                if (bc) {
                  const slaveSession = bc.targetSessions.get(slaveTargetId);
                  if (slaveSession) {
                    cdpManager.navigateToSession(slaveId, slaveSession.sessionId, navUrl);
                    logger.info({ slaveId, slaveTargetId, url: navUrl }, 'MULTI-CONTROL: navigated mapped slave tab');
                    navigatedMapped = true;
                    continue;
                  }
                }
              }
            }
            if (navigatedMapped) return;
          }
        }

        for (const [slaveId] of controller.slaves) {
          cdpManager.navigateTo(slaveId, navUrl);
        }
      }
    };

    cdpManager.onTabDestroyed = (profileId, targetId) => {
      if (!controller.active) return;
      if (profileId === masterId) {
        const bySlave = controller.tabMapping.get(targetId);
        if (bySlave) {
          for (const [slaveId, slaveTargetId] of bySlave) {
            cdpManager.closeTarget(slaveId, slaveTargetId);
            logger.info({ slaveId, slaveTargetId, masterTargetId: targetId }, 'MULTI-CONTROL: closed slave tab on master tab destroy');
          }
        }
        controller.unmapTab(targetId);
        controller._maybeSwitchToPrevTab(targetId);
        logger.info({ targetId, newActiveTab: controller.activeMasterTab }, 'MULTI-CONTROL: focus returned to previous tab after destroy');
      } else {
        controller._unmapBySlaveTargetId(targetId);
      }
    };

    cdpManager.onTabActivated = (profileId, targetId) => {
      if (profileId === masterId && controller.active) {
        controller.setActiveMasterTab(targetId);
        controller._syncActiveTabToSlaves(targetId);
      }
    };

    await cdpManager.connect(masterId, port, { enableInput: true });

    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(masterId);
    if (profile) {
      cdpManager.setWindowTitle(masterId, `${profile.name} [MASTER]`);
    }

    controller.setMaster(masterId);

    wireInputToController();
    inputCapture.start();

    discoverActiveTab();
    controller._discoveryTimer = setInterval(discoverActiveTab, 300);
    logger.info('MULTI-CONTROL: CDP input capture started for master');

    res.json({ status: 'active', masterId, mode: 'cdp' });
  } catch (err) {
    logger.error({ err: err.message }, 'Multi-control: failed to start');
    res.status(500).json({ error: `Ошибка запуска: ${err.message}` });
  }
});

router.post('/stop', async (req, res) => {
  if (controller._discoveryTimer) {
    clearInterval(controller._discoveryTimer);
    controller._discoveryTimer = null;
  }
  pendingSync.clear();
  attachedMasterTabs.clear();
  inputCapture.stop();
  cdpManager.onEvent = null;
  cdpManager.onNavigate = null;
  cdpManager.onNewTab = null;
  cdpManager.onTabAttached = null;
  cdpManager.onTabDestroyed = null;
  cdpManager.onTabActivated = null;
  cdpManager.disconnectAll();
  controller.stop();
  logger.info('MULTI-CONTROL: STOPPED');
  res.json({ status: 'stopped' });
});

router.post('/slave/add', async (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  if (!controller.getStatus().active) {
    return res.status(409).json({ error: 'Multi-control не активен' });
  }

  const port = getCdpPort(profileId);
  if (!port) {
    return res.status(412).json({ error: `CDP порт недоступен для ${profileId}` });
  }

  try {
    await cdpManager.connect(profileId, port, { enableInput: false });

    const masterSession = cdpManager.sessions.get(controller.masterId);
    const slaveSession = cdpManager.sessions.get(profileId);
    if (masterSession && slaveSession) {
      controller.mapTab(masterSession.targetId, profileId, slaveSession.targetId);
      logger.info({ masterTargetId: masterSession.targetId, slaveId: profileId, slaveTargetId: slaveSession.targetId }, 'MULTI-CONTROL: mapped initial tabs');
    }

    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(profileId);
    if (profile) {
      cdpManager.setWindowTitle(profileId, `${profile.name} [SYNC]`);
    }

    await controller.addSlave(profileId);
    res.json({ status: 'added', profileId, slaveCount: controller.getStatus().slaveCount });
  } catch (err) {
    logger.error({ err: err.message }, `Multi-control: failed to connect CDP to slave ${profileId}`);
    res.status(500).json({ error: `Ошибка подключения CDP: ${err.message}` });
  }
});

router.post('/slave/remove', (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  cdpManager.disconnect(profileId);
  controller.removeSlave(profileId);
  res.json({ status: 'removed', profileId });
});

router.post('/window-position', (req, res) => {
  const { profileId, x, y, width, height } = req.body;
  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }
  controller.setWindowPosition(profileId, x || 0, y || 0, width || 800, height || 600);
  res.json({ status: 'ok' });
});

router.get('/cdp-status', (req, res) => {
  const result = {};
  for (const [id] of controller.slaves) {
    result[id] = cdpManager.isConnected(id);
  }
  if (controller.masterId) {
    result[controller.masterId] = cdpManager.isConnected(controller.masterId);
  }
  res.json(result);
});

router.post('/os-keyboard', async (req, res) => {
  if (!controller.active) return res.json({ ok: true, skipped: 'inactive' });

  const event = req.body;

  logger.info({
    type: event.type,
    key: event.key,
    activeMasterTab: controller.activeMasterTab,
    tabMappingSize: controller.tabMapping.size,
    hasActiveMapping: controller.activeMasterTab ? controller.tabMapping.has(controller.activeMasterTab) : false,
    slaveCount: controller.slaves.size,
  }, 'OS-KEYBOARD: received event');

  if (event.type === 'keyDown' && event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = (event.key || '').toLowerCase();

    if (key === 't') {
      logger.info('OS-KEYBOARD: Ctrl+T detected, letting browser handle natively (discoverActiveTab will sync)');
      return res.json({ ok: true, action: 'skip' });
    }

    if (key === 'w') {
      logger.info({ activeMasterTab: controller.activeMasterTab }, 'OS-KEYBOARD: Ctrl+W detected, closing slave tabs via CDP');
      const activeTab = controller.activeMasterTab;
      if (activeTab) {
        const bySlave = controller.tabMapping.get(activeTab);
        if (bySlave) {
          for (const [slaveId, slaveTargetId] of bySlave) {
            cdpManager.closeTarget(slaveId, slaveTargetId);
            logger.info({ slaveId, slaveTargetId, masterTargetId: activeTab }, 'OS-KEYBOARD: closed slave tab on Ctrl+W');
          }
        }
        controller.unmapTab(activeTab);
      }
      // Browser сам закроет master-таб (preventDefault для KeyW удалён из sync script)
      return res.json({ ok: true, action: 'closeTab' });
    }
  }

  // Перед Enter убеждаемся, что activeMasterTab актуален. Антидетект не сообщает
  // о нативно открытых табах через WS, поэтому polling /json может отставать на
  // ≤300мс. Enter критичен (навигация по адресу/отправка формы), остальные клавиши
  // только накапливаются в адресной строке. Без этого Enter уходит в устаревший таб.
  if (event.type === 'keyDown' && event.key === 'Enter') {
    await discoverActiveTab();
  }

  if (event.type === 'keyDown') {
    controller.onKeyDown(event);
  } else if (event.type === 'keyUp') {
    controller.onKeyUp(event);
  }

  res.json({ ok: true });
});

async function focusWindowByPid(pid) {
  const platform = process.platform;
  try {
    if (platform === 'linux') {
      const { stdout } = await execAsync(`xdotool search --pid ${pid} 2>/dev/null | head -1`);
      const windowId = stdout.trim();
      if (windowId) await execAsync(`xdotool windowactivate ${windowId}`);
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null`);
      const appName = stdout.trim().replace(/\.app\/.*$/, '.app');
      if (appName) await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
    } else if (platform === 'win32') {
      const ps = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    public static void Focus(uint targetPid) {
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid) {
                SetForegroundWindow(hWnd);
                return false;
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@
[WinFocus]::Focus(${pid})
`;
      await runPowerShellScript(ps);
    }
  } catch (err) {
    logger.error({ err: err.message, pid }, 'Error focusing window by PID');
  }
}

router.post('/focus-windows', async (req, res) => {
  try {
    const db = getDatabase();
    const pq = createProfileQueries(db);
    const masterId = controller.masterId;
    const slaveIds = Array.from(controller.slaves.keys());
    const allIds = [...slaveIds, masterId].filter(Boolean);
    const pidMap = new Map();

    for (const id of allIds) {
      const profile = pq.getById(id);
      if (profile?.pid) pidMap.set(id, profile.pid);
    }

    for (const id of slaveIds) {
      const pid = pidMap.get(id);
      if (pid) {
        await focusWindowByPid(pid);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    if (masterId) {
      const pid = pidMap.get(masterId);
      if (pid) {
        await new Promise(r => setTimeout(r, 150));
        await focusWindowByPid(pid);
      }
    }

    logger.info({ slavePids: slaveIds.filter(id => pidMap.has(id)).length, masterPid: pidMap.has(masterId) }, 'MULTI-CONTROL: focused sync windows by PID');
    res.json({ focused: true });
  } catch (err) {
    logger.error({ err: err.message }, 'MULTI-CONTROL: focus-windows failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
