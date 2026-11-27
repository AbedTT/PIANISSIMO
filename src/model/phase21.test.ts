// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkScore, outOfRange } from './checks';
import { fillLeftHand, suggestChords } from './harmonise';
import { scoreFromInstruments } from './parts';
import { midiOf } from './pitch';
import { lane, newScore, writeStream } from './score';
import { parseMelody } from './templates';
import { isRest } from './types';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

describe('instrument ranges and score checks', () => {
  it('flags notes an instrument cannot play', () => {
    const s = scoreFromInstruments(['violin', 'cello'], { measures: 2 }, newScore);
    writeStream(s, 0, parseMelody('G3:q F3:q A7:q C8:q'));
    const [g3, f3, a7, c8] = lane(s, 0, 0);
    expect([outOfRange(s, 0, g3), outOfRange(s, 0, a7)]).toEqual([null, null]);
    expect(outOfRange(s, 0, f3)).toMatch(/too low for Violin \(lowest G3\)/);
    expect(outOfRange(s, 0, c8)).toMatch(/too high/);
    const issues = checkScore(s);
    expect(issues.filter((x) => x.kind === 'range')).toHaveLength(2);
    expect(issues.find((x) => x.kind === 'empty')?.message).toBe('Cello has no notes yet');
  });

  it('finds short bars, dangling ties and lines that lost their end', () => {
    const s = newScore({ measures: 2, staves: [{ clef: 'treble' }] });
    writeStream(s, 0, parseMelody('C4:q D4:q E4:q F4:q | G4:w'));
    const bar = lane(s, 0, 0);
    bar[3].tie = true; // F4 tied to G4: wrong pitch
    bar[0].slurEnd = 'gone';
    bar[1].spans = [{ kind: 'cresc', end: 'nowhere' }];
    s.measures[1].staves[0] = [{ ...lane(s, 1, 0)[0], type: 'h' }]; // only half a bar
    const kinds = checkScore(s).map((x) => x.kind).sort();
    expect(kinds).toEqual(['length', 'line', 'slur', 'tie']);
    expect(checkScore(s).find((x) => x.kind === 'length')!.message).toBe('Bar 2: the notes add up to 2 beats, the bar holds 4 beats');
    expect(checkScore(newScore({ measures: 3 }))).toEqual([]);
  });
});

describe('chord suggestions', () => {
  const bar = (melody: string, keyFifths = 0) => {
    const s = newScore({ measures: 1, keyFifths, staves: [{ clef: 'treble' }] });
    writeStream(s, 0, parseMelody(melody));
    return suggestChords(s, 0, 0);
  };

  it('picks the chord that holds the melody', () => {
    expect(bar('C5:q E5:q G5:q E5:q')[0].symbol).toBe('C');
    expect(bar('F4:q A4:q C5:h')[0].symbol).toBe('F');
    expect(bar('G4:q B4:q D5:q B4:q')[0].symbol).toBe('G');
    expect(bar('A4:h C5:q E5:q')[0].symbol).toBe('Am');
    // the seventh in the melody brings V7
    expect(bar('G4:q B4:q D5:q F5:q')[0].symbol).toBe('G7');
    // keys with sharps and flats are spelled in the key
    expect(bar('D5:q F#5:q A5:h', 2)[0].symbol).toBe('D');
    expect(bar('Bb4:q D5:q F5:h', -1)[0]).toMatchObject({ symbol: 'Bb', degree: 'IV' });
  });

  it('returns nothing for an empty bar, and three ideas otherwise', () => {
    expect(suggestChords(newScore({ measures: 1, staves: [{ clef: 'treble' }] }), 0, 0)).toEqual([]);
    expect(bar('E4:w')).toHaveLength(3);
  });
});

describe('left-hand accompaniment', () => {
  const song = () => {
    const s = newScore({ measures: 3, staves: [{ clef: 'treble' }, { clef: 'bass' }] });
    writeStream(s, 0, parseMelody('E5:w | F5:h D5:h | C5:w'));
    lane(s, 0, 0)[0].harmony = 'C';
    lane(s, 1, 0)[0].harmony = 'F';
    lane(s, 1, 0)[1].harmony = 'G7';
    return s;
  };

  it('writes real notes from the chord symbols, following chord changes inside a bar', () => {
    const s = song();
    expect(fillLeftHand(s, 1, 'pop')).toBe(3);
    const pcs = (m: number) => lane(s, m, 1).filter((e) => !isRest(e)).map((e) => e.pitches.map((p) => midiOf(p) % 12).sort((a, b) => a - b));
    expect(pcs(0)[0]).toEqual([0]); // C in the bass on beat 1
    expect(pcs(0)[1]).toEqual([0, 4, 7]); // then the chord
    expect(pcs(1)[0]).toEqual([5]); // F bass
    expect(pcs(1)[2]).toEqual([7]); // G7 starts on beat 3 with its bass
    expect(pcs(1)[3]).toEqual([2, 5, 7, 11]);
    // the chord carries on into bar 3 (no new symbol there)
    expect(pcs(2)[0]).toEqual([7]);
    // every note sits in a left-hand range
    for (let m = 0; m < 3; m++) for (const e of lane(s, m, 1)) for (const p of e.pitches) expect(midiOf(p)).toBeGreaterThanOrEqual(40);
  });

  it('leaves bars that already have notes alone; styles shape the rhythm', () => {
    const s = song();
    writeStream(s, 1, parseMelody('C3:w'), 0);
    expect(fillLeftHand(s, 1, 'block')).toBe(2);
    expect(lane(s, 0, 1).map((e) => e.type)).toEqual(['w']);
    const arp = song();
    fillLeftHand(arp, 1, 'arpeggio');
    expect(lane(arp, 0, 1).every((e) => e.type === '8' && e.pitches.length === 1)).toBe(true);
  });
});
