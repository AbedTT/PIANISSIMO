// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { cleanStack, reporter } from './errors';

vi.stubGlobal('location', { pathname: '/pianissimo/dist/app.html', origin: 'https://music.example.com' });

describe('error reports', () => {
  it('keep file names and lines, but not the address, query strings or #parts', () => {
    const stack = [
      'TypeError: x is undefined',
      '    at render (https://music.example.com/pianissimo/dist/assets/renderer-abc.js?v=2:10:5)',
      '    at https://music.example.com/pianissimo/dist/app.html#reset=0123456789abcdef:1:1',
    ].join('\n');
    const clean = cleanStack(stack, 'https://music.example.com');
    expect(clean).toContain('/pianissimo/dist/assets/renderer-abc.js:10:5');
    expect(clean).not.toContain('music.example.com');
    expect(clean).not.toContain('?v=2');
    expect(clean).not.toContain('reset=');
  });

  it('send each error once, at most five per page, and skip noise', () => {
    const sent: { message: string; page: string; version: string }[] = [];
    const report = reporter((r) => sent.push(r));
    report('TypeError: a', 'at x.js:1:1');
    report('TypeError: a', 'at x.js:1:1'); // the same again
    report('Script error.', ''); // another origin: no details
    report('ResizeObserver loop completed with undelivered notifications.', '');
    report('Error: from an add-on', 'at chrome-extension://abc/content.js:1:1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ message: 'TypeError: a', page: 'app.html', version: expect.stringMatching(/^\d+\.\d+/) });
    for (let i = 0; i < 10; i++) report(`Error ${i}`, '');
    expect(sent).toHaveLength(5);
  });
});
