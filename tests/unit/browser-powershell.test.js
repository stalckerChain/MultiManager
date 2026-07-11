import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Browser — PowerShell invocation pattern', () => {
  it('содержит toPSEncoded и runPowerShellScript helper-функции', () => {
    const content = readFileSync(
      new URL('../../src/api/browser.js', import.meta.url),
      'utf-8'
    );
    expect(content).toContain('toPSEncoded');
    expect(content).toContain('runPowerShellScript');
    expect(content).toContain("Buffer.from(script, 'utf16le').toString('base64')");
  });

  it('findWindowByPid использует spawn + -EncodedCommand, не execAsync', () => {
    const content = readFileSync(
      new URL('../../src/api/browser.js', import.meta.url),
      'utf-8'
    );
    expect(content).toContain('-EncodedCommand');
    expect(content).toContain("spawn('powershell', [");
    expect(content).toContain("'-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'");
    expect(content).toContain('runPowerShellScript(ps)');
    expect(content).not.toContain("promisify(exec)");
    expect(content).not.toContain("execAsync(ps)");
    expect(content).not.toContain("const { exec } = require('child_process')");
  });

  it('не содержит -File, -Command- (stdin) или temp-файлы', () => {
    const content = readFileSync(
      new URL('../../src/api/browser.js', import.meta.url),
      'utf-8'
    );
    expect(content).not.toContain('-File "');
    expect(content).not.toContain("'-Command', '-'");
    expect(content).not.toContain('writeFileSync');
    expect(content).not.toContain('unlinkSync');
  });

  it('PS скрипт findWindowByPid содержит WinFind class', () => {
    const content = readFileSync(
      new URL('../../src/api/browser.js', import.meta.url),
      'utf-8'
    );
    expect(content).toContain('WinFind');
    expect(content).toContain('EnumWindows');
    expect(content).toContain('IsWindowVisible');
    expect(content).toContain('GetWindowThreadProcessId');
    expect(content).toContain('targetPid');
  });

  it('PS скрипт использует Add-Type @"..."@ с C# кодом', () => {
    const content = readFileSync(
      new URL('../../src/api/browser.js', import.meta.url),
      'utf-8'
    );
    expect(content).toContain('Add-Type @"');
    expect(content).toContain('using System;');
    expect(content).toContain('using System.Runtime.InteropServices;');
    expect(content).toContain('DllImport("user32.dll")');
  });
});
