import { describe, expect, test } from 'vitest';
import { MAX_TOASTS, readingMs } from '../render/ui';

describe('messages', () => {
  test('stay up long enough for a beginner reader: longer messages stay longer', () => {
    const short = readingMs('The water is full.');
    const long = readingMs('Nugget is all grown up into a hen! Look at that red comb. Hens lay eggs, so keep an eye on the nest box.');
    expect(short).toBeGreaterThanOrEqual(5000);
    expect(long).toBeGreaterThan(short + 10000);
    // about a second a word for a child sounding words out, not the 3.8 seconds every message used to get
    expect(long).toBeGreaterThan(22 * 650);
  });

  test('emoji do not count as words to read', () => {
    expect(readingMs('🐔 Hello there!')).toBe(readingMs('Hello there!'));
  });

  test('a few at a time, so they can be read', () => {
    expect(MAX_TOASTS).toBe(3);
  });
});
