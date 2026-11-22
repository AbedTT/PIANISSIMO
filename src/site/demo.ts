import { newScore, writeAt } from '../model/score';
import type { DurationType, Score, Step } from '../model/types';

/** "Ode to Joy" (Beethoven, public domain) with chords and lyrics, for the home page demo. */
export function demoScore(): Score {
  const s = newScore({ title: 'Ode to Joy', composer: 'L. van Beethoven', measures: 4, tempo: 120, staves: [{ clef: 'treble', sound: 'piano' }] });
  const melody: [Step, number, DurationType, number][][] = [
    [['E', 4, 'q', 0], ['E', 4, 'q', 0], ['F', 4, 'q', 0], ['G', 4, 'q', 0]],
    [['G', 4, 'q', 0], ['F', 4, 'q', 0], ['E', 4, 'q', 0], ['D', 4, 'q', 0]],
    [['C', 4, 'q', 0], ['C', 4, 'q', 0], ['D', 4, 'q', 0], ['E', 4, 'q', 0]],
    [['E', 4, 'q', 1], ['D', 4, '8', 0], ['D', 4, 'h', 0]],
  ];
  melody.forEach((bar, m) =>
    bar.forEach(([step, octave, type, dots], i) =>
      writeAt(s, m, 0, i, { pitches: [{ step, octave, alter: 0 }], type, dots }),
    ),
  );
  // 15 syllables for the 15 notes of the phrase (text: Henry van Dyke, 1907, public domain)
  const words = ['Joy', 'ful,', 'joy', 'ful,', 'we', 'a', 'dore', 'Thee,', 'God', 'of', 'glo', 'ry,', 'Lord', 'of', 'love'];
  const hyphen = new Set([0, 2, 5, 10]);
  let k = 0;
  for (const bar of s.measures) for (const e of bar.staves[0]) if (e.pitches.length && k < words.length) {
    e.lyric = { text: words[k], ...(hyphen.has(k) ? { hyphen: true } : {}) };
    k++;
  }
  const chords = ['C', 'G', 'C', 'G7'];
  s.measures.forEach((bar, m) => (bar.staves[0][0].harmony = chords[m]));
  s.measures[1].staves[0][2].harmony = 'C';
  s.accompaniment = { enabled: true, style: 'pop', sound: 'guitar_nylon' };
  return s;
}
