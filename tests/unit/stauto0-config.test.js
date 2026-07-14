import { describe, it, expect } from 'vitest';
import { parseAccountRanges } from '../../src/config/stauto0-config';

describe('parseAccountRanges', () => {
  it('parses single range', () => {
    const result = parseAccountRanges(['001-005']);
    expect(result).toEqual(['auto_001', 'auto_002', 'auto_003', 'auto_004', 'auto_005']);
  });

  it('parses single number', () => {
    const result = parseAccountRanges(['055']);
    expect(result).toEqual(['auto_055']);
  });

  it('parses multiple ranges and singles', () => {
    const result = parseAccountRanges(['001-003', '005', '008-010']);
    expect(result).toEqual([
      'auto_001', 'auto_002', 'auto_003',
      'auto_005',
      'auto_008', 'auto_009', 'auto_010'
    ]);
  });

  it('handles large range', () => {
    const result = parseAccountRanges(['001-050']);
    expect(result.length).toBe(50);
    expect(result[0]).toBe('auto_001');
    expect(result[49]).toBe('auto_050');
  });

  it('returns empty array for empty input', () => {
    expect(parseAccountRanges([])).toEqual([]);
  });

  it('handles non-string entries gracefully', () => {
    const result = parseAccountRanges([123, null, '001-002']);
    expect(result).toEqual(['auto_001', 'auto_002']);
  });
});
