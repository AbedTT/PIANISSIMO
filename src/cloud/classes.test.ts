// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toIcs } from './classesUi';

describe('assignment calendar', () => {
  it('writes all-day events that calendar apps import', () => {
    const ics = toIcs([{ id: 7, title: 'Scales, part 2', due_at: '2030-01-31', class_id: 1, class: 'Year 9; music', role: 'student', status: 'working' }]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20300131\r\nDTEND;VALUE=DATE:20300201');
    expect(ics).toContain('UID:pianissimo-assignment-7');
    // commas and semicolons are escaped as the format requires
    expect(ics).toContain('SUMMARY:Due: Scales\\, part 2 (Year 9\\; music)');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});
