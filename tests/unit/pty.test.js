import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

describe('PTY Module', () => {
  let pty;

  beforeEach(async () => {
    pty = await import('../../gui/src/main/pty.js');
  });

  describe('exports', () => {
    it('экспортирует init, startPty и stopPty', () => {
      expect(pty).toHaveProperty('init');
      expect(pty).toHaveProperty('startPty');
      expect(pty).toHaveProperty('stopPty');
      expect(typeof pty.init).toBe('function');
      expect(typeof pty.startPty).toBe('function');
        expect(typeof pty.stopPty).toBe('function');
    });
  });

  // init() requires ipcMain from electron — тестируется интеграционно

  describe('startPty', () => {
    it('возвращает ошибку если файл не существует', () => {
      const result = pty.startPty('C:\\nonexistent\\log.log', { isDestroyed: () => false, send: vi.fn() });
      expect(result).toEqual({ success: false, error: 'File not found' });
    });

    it('возвращает success при успешном запуске', () => {
      const sender = { isDestroyed: () => false, send: vi.fn() };
      const result = pty.startPty(__filename, sender);
      expect(result.success).toBe(true);
      pty.stopPty();
    });
  });

  describe('stopPty', () => {
    it('безопасно вызывается когда процесс не запущен', () => {
      expect(pty.stopPty()).toEqual({ success: true });
    });
  });
});
