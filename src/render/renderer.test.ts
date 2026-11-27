// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newScore } from '../model/score';
import { Editor } from '../editor/editor';
import { renderScore, renderStats } from './renderer';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

/** A 16-bar melody: enough for several systems at 700px. */
function song() {
  const ed = new Editor(newScore({ measures: 16, staves: [{ clef: 'treble' }] }));
  for (let k = 0; k < 64; k++) ed.typeLetter((['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const)[k % 7]);
  return ed;
}

describe('incremental rendering', () => {
  it('reuses every system when nothing changed', () => {
    const ed = song();
    const host = document.createElement('div');
    const first = renderScore(host, ed.score, 700);
    const systems = first.systems.length;
    expect(systems).toBeGreaterThan(2);
    expect(renderStats).toEqual({ drawn: systems, reused: 0 });
    const again = renderScore(host, ed.score, 700);
    expect(renderStats).toEqual({ drawn: 0, reused: systems });
    // geometry of reused systems is still all there
    expect(again.events.size).toBe(first.events.size);
    expect(again.staves.length).toBe(first.staves.length);
    expect(host.querySelectorAll('svg > g.vf-system').length).toBe(systems);
  });

  it('an edit in one bar redraws only the system holding it', () => {
    const ed = song();
    const host = document.createElement('div');
    const layout = renderScore(host, ed.score, 700);
    const last = layout.systems[layout.systems.length - 1].measures[0];
    ed.setCursor({ m: last, s: 0, i: 0 });
    ed.typeLetter('G');
    renderScore(host, ed.score, 700);
    expect(renderStats.drawn).toBe(1);
    expect(renderStats.reused).toBe(layout.systems.length - 1);
  });

  it('a tie into the next system redraws both systems', () => {
    const ed = song();
    const host = document.createElement('div');
    const layout = renderScore(host, ed.score, 700);
    const sys0 = layout.systems[0].measures;
    const lastBar = sys0[sys0.length - 1];
    ed.setCursor({ m: lastBar, s: 0, i: 3 });
    ed.typeLetter('C');
    renderScore(host, ed.score, 700); // the note changed: only its system
    ed.setCursor({ m: lastBar, s: 0, i: 3 });
    ed.toggleTie();
    renderScore(host, ed.score, 700);
    expect(renderStats.drawn).toBe(2);
  });

  it('a different width redraws everything', () => {
    const ed = song();
    const host = document.createElement('div');
    renderScore(host, ed.score, 700);
    const l = renderScore(host, ed.score, 900);
    expect(renderStats).toEqual({ drawn: l.systems.length, reused: 0 });
  });
});
