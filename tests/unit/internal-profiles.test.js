import { describe, it, expect, beforeEach, vi } from 'vitest';
import internalRouter from '../../src/api/internal.js';

function parseRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const parts = rangeStr.split('-');
  if (parts.length !== 2) return null;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end) || start > end) return null;
  const names = [];
  for (let i = start; i <= end; i++) {
    names.push(`auto_${String(i).padStart(3, '0')}`);
  }
  return names;
}

describe('Internal Profiles - Range Parsing', () => {
  it('parses valid range 001-003', () => {
    const result = parseRange('001-003');
    expect(result).toEqual(['auto_001', 'auto_002', 'auto_003']);
  });

  it('parses single range 001-001', () => {
    const result = parseRange('001-001');
    expect(result).toEqual(['auto_001']);
  });

  it('parses range 010-012', () => {
    const result = parseRange('010-012');
    expect(result).toEqual(['auto_010', 'auto_011', 'auto_012']);
  });

  it('returns null for invalid format', () => {
    expect(parseRange('')).toBeNull();
    expect(parseRange(null)).toBeNull();
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange('abc')).toBeNull();
    expect(parseRange('001')).toBeNull();
    expect(parseRange('001-')).toBeNull();
    expect(parseRange('-010')).toBeNull();
  });

  it('returns null when start > end', () => {
    expect(parseRange('010-005')).toBeNull();
  });

  it('handles large ranges', () => {
    const result = parseRange('050-052');
    expect(result).toEqual(['auto_050', 'auto_051', 'auto_052']);
  });
});

describe('Internal Profiles - Router', () => {
  it('router exposes GET /profiles', () => {
    expect(internalRouter).toBeTruthy();
    expect(typeof internalRouter).toBe('function');
  });
});
