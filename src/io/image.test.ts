// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newScore } from '../model/score';
import { scoreToSvg } from './image';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  if (!('fonts' in document)) Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
});

describe('image export', () => {
  it('keeps the ink colour that staff lines, stems and barlines inherit from the <svg>', async () => {
    const svg = await scoreToSvg(newScore({ measures: 2 }));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const music = doc.querySelector('g[transform^="translate(0"]')!;
    expect(music.getAttribute('stroke')).toBeTruthy();
    expect(music.getAttribute('stroke')).not.toBe('none');
    expect(music.getAttribute('fill')).toBeTruthy();
    // staff lines carry no stroke of their own: without the wrapper's they would be invisible
    const staffLine = music.querySelector('.vf-stave path')!;
    expect(staffLine.getAttribute('stroke')).toBeNull();
  });
});
