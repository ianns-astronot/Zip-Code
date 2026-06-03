import { describe, it, expect, beforeEach } from 'vitest';
import { inputHistory } from '../src/input-history';

/**
 * Tests for the persistent input history. Each test uses a unique session
 * id so we don't need to worry about cross-test pollution (the on-disk
 * SQLite store is shared).
 */
describe('InputHistory', () => {
  let sid: string;
  beforeEach(() => {
    sid = 'test-' + Math.random().toString(36).slice(2);
    inputHistory.ensureSchema();
    inputHistory.clearSession(sid);
  });

  it('persists pushed values to SQLite and reloads them', () => {
    inputHistory.push(sid, 'first command');
    inputHistory.push(sid, 'second command');
    inputHistory.reload(sid);
    // Most recent first (n=0).
    expect(inputHistory.get(sid, 0)).toBe('second command');
    expect(inputHistory.get(sid, 1)).toBe('first command');
  });

  it('skips empty / whitespace-only values', () => {
    inputHistory.push(sid, '   ');
    inputHistory.push(sid, '');
    inputHistory.push(sid, '\n\t  \n');
    expect(inputHistory.size(sid)).toBe(0);
  });

  it('dedupes consecutive identical values', () => {
    inputHistory.push(sid, 'hello');
    inputHistory.push(sid, 'hello');
    inputHistory.push(sid, 'hello');
    expect(inputHistory.size(sid)).toBe(1);
  });

  it('does NOT dedupe non-consecutive identical values', () => {
    inputHistory.push(sid, 'hello');
    inputHistory.push(sid, 'world');
    inputHistory.push(sid, 'hello');
    expect(inputHistory.size(sid)).toBe(3);
  });

  it('returns undefined for out-of-range indices', () => {
    inputHistory.push(sid, 'only-one');
    expect(inputHistory.get(sid, 5)).toBeUndefined();
    expect(inputHistory.get(sid, -1)).toBeUndefined();
  });

  it('keeps separate histories per session', () => {
    const sidA = sid;
    const sidB = sid + '-other';
    inputHistory.clearSession(sidB);

    inputHistory.push(sidA, 'A1');
    inputHistory.push(sidB, 'B1');
    inputHistory.push(sidA, 'A2');
    inputHistory.push(sidB, 'B2');

    expect(inputHistory.size(sidA)).toBe(2);
    expect(inputHistory.size(sidB)).toBe(2);
    expect(inputHistory.get(sidA, 0)).toBe('A2');
    expect(inputHistory.get(sidB, 0)).toBe('B2');
  });

  it('clearSession removes one session but leaves others', () => {
    const sidA = sid;
    const sidB = sid + '-other';
    inputHistory.clearSession(sidB);

    inputHistory.push(sidA, 'keep me');
    inputHistory.push(sidB, 'delete me');
    inputHistory.clearSession(sidB);
    expect(inputHistory.size(sidA)).toBe(1);
    expect(inputHistory.size(sidB)).toBe(0);
  });

  it('trims trailing whitespace before storing', () => {
    inputHistory.push(sid, 'padded   ');
    expect(inputHistory.get(sid, 0)).toBe('padded');
  });

  it('enforces the per-session max (default 200)', () => {
    for (let i = 0; i < 210; i++) {
      inputHistory.push(sid, 'entry-' + i);
    }
    expect(inputHistory.size(sid)).toBe(200);
    // The most recent should be entry-209.
    expect(inputHistory.get(sid, 0)).toBe('entry-209');
    // The oldest kept should be entry-10 (0..9 dropped).
    expect(inputHistory.get(sid, 199)).toBe('entry-10');
  });
});
