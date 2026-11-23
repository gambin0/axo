/**
 * Letters for a child learning the alphabet. Device voices read a lone capital
 * unreliably ("A" often comes out as "uh"), so every letter is spoken by its
 * name written out, and each name is a single word so it lights up on its own.
 */

const NAMES: Record<string, string> = {
  a: 'eh', b: 'bee', c: 'see', d: 'dee', e: 'ee', f: 'eff', g: 'jee', h: 'aitch', i: 'eye', j: 'jay', k: 'kay', l: 'ell', m: 'em',
  n: 'en', o: 'oh', p: 'pee', q: 'cue', r: 'ar', s: 'ess', t: 'tee', u: 'you', v: 'vee', w: 'double-you', x: 'ex', y: 'why', z: 'zee',
};

/** A word for each letter that starts with its usual sound (x is the odd one out: it ends "fox"). */
const WORDS: Record<string, string> = {
  a: 'apple', b: 'ball', c: 'cat', d: 'dog', e: 'egg', f: 'fish', g: 'goat', h: 'hat', i: 'insect', j: 'jam', k: 'kite', l: 'leaf', m: 'moon',
  n: 'nest', o: 'octopus', p: 'pig', q: 'queen', r: 'rabbit', s: 'sun', t: 'tadpole', u: 'umbrella', v: 'van', w: 'worm', x: 'fox', y: 'yo-yo', z: 'zebra',
};

export const isLetter = (ch: string): boolean => /^[a-z]$/i.test(ch);

/** How to say a letter's name: "em". British English says "zed". */
export function letterName(ch: string, lang = ''): string {
  const k = ch.toLowerCase();
  if (k === 'z' && /^en-(gb|au|nz|ie|za|in)/i.test(lang)) return 'zed';
  return NAMES[k] ?? ch;
}

/**
 * What to say when a letter is held: its name, then a word that starts with it. The
 * word it was found in is used when it starts that word and makes its usual sound
 * there (not "ch", "sh", "th", a soft c or g...), so the M in Mochi says "M is for Mochi".
 */
export function letterSpeech(ch: string, inWord = '', lang = ''): string {
  const k = ch.toLowerCase();
  const name = letterName(k, lang);
  const word = inWord.replace(/[^a-z'-]/gi, '');
  const own =
    word.length > 1 &&
    word[0].toLowerCase() === k &&
    !/^(ch|sh|th|ph|wh|gh|kn|wr|ce|ci|cy|ge|gi|gy|ea|ee|ei|ie|oo|ou|ow|oy|oi|ai|ay|au|aw|ue|ui)/i.test(word) &&
    !/^[aeiou][^aeiou]e$/i.test(word); // "ate", "ice": a long vowel, not the usual sound
  if (k === 'x') return `${name}. Fox ends with ${name}.`;
  return `${name}. ${name} is for ${own ? word : WORDS[k]}.`;
}

/**
 * Spelling a name out: "em, oh, see, aitch, eye." Only letters are spelled; the
 * returned count is how many spoken words that took (one per letter).
 */
export function spellOut(text: string, lang = ''): { spoken: string; letters: number } {
  const names = [...text].filter(isLetter).map((ch) => letterName(ch, lang));
  return { spoken: names.length ? `${names.join(', ')}.` : '', letters: names.length };
}
