import { describe, expect, test } from 'vitest';
import { letterName, letterSpeech, spellOut } from '../core/letters';
import { splitWords } from '../core/speech';

describe('letters', () => {
  test('letter names are single words', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') expect(splitWords(letterName(ch))).toHaveLength(1);
    expect(letterName('Z', 'en-GB')).toBe('zed');
    expect(letterName('z', 'en-US')).toBe('zee');
  });

  test('a held letter is named, with a word that starts with it', () => {
    expect(letterSpeech('M', 'Mochi')).toBe('em. em is for Mochi.');
    expect(letterSpeech('o', 'Mochi')).toBe('oh. oh is for octopus.');
    expect(letterSpeech('C', 'Cheeky')).toBe('see. see is for cat.'); // "ch" is not the c sound
    expect(letterSpeech('S', 'Seeds,')).toBe('ess. ess is for Seeds.');
    expect(letterSpeech('x', 'box')).toBe('ex. Fox ends with ex.');
  });

  test('spelling a name gives one spoken word per letter', () => {
    const { spoken, letters } = spellOut('Mr Bun 2');
    expect(spoken).toBe('em, ar, bee, you, en.');
    expect(letters).toBe(5);
    expect(splitWords(spoken)).toHaveLength(5);
    expect(spellOut('').spoken).toBe('');
  });
});
