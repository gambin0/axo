import { describe, expect, test } from 'vitest';
import { spokenText, splitWords, wordAt, wordTimings } from '../core/speech';
import { freshSave, migrate } from '../core/save';

describe('read aloud', () => {
  test('emoji are shown but not read out', () => {
    expect(spokenText('A butterfly came out! 🦋')).toBe('A butterfly came out!');
    expect(spokenText('Tap 🐚 to offer a bigger one!')).toBe('Tap to offer a bigger one!');
    expect(spokenText('🦋')).toBe('');
  });

  test('a speech boundary lights up the right word', () => {
    const words = splitWords('The egg hatched!');
    expect(words.map((w) => w.text)).toEqual(['The', 'egg', 'hatched!']);
    expect(wordAt(words, 0)).toBe(0);
    expect(wordAt(words, 4)).toBe(1);
    expect(wordAt(words, 9)).toBe(2);
  });

  test('estimated timings start at zero and keep going forward', () => {
    const at = wordTimings(splitWords('Bo ate three big worms.'));
    expect(at[0]).toBe(0);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    expect(at[at.length - 1]).toBeLessThan(1);
  });

  test('read aloud is on for new and old saves', () => {
    expect(freshSave(0).settings.readAloud).toBe(true);
    expect(migrate({ version: 3, lastSeen: 1, settings: { sound: false }, pets: {} })?.settings).toEqual({ sound: false, readAloud: true });
  });
});
