import { describe, expect, it } from 'vitest';
import { newScore } from '../model/score';
import { isValidScore } from '../model/validate';
import { LocalLibrary, memoryStore } from './local';

describe('the library on this computer', () => {
  it('keeps many scores, newest first, and saves over the same entry', async () => {
    const lib = new LocalLibrary(memoryStore());
    const a = await lib.save(newScore({ title: 'Hymn' }));
    await new Promise((r) => setTimeout(r, 5));
    const b = await lib.save(newScore({ title: 'Carol', composer: 'Me' }));
    expect((await lib.list()).map((s) => s.title)).toEqual(['Carol', 'Hymn']);

    await new Promise((r) => setTimeout(r, 5));
    const again = await lib.save({ ...newScore({ title: 'Hymn, new words' }) }, a.id);
    expect(again.id).toBe(a.id);
    expect(again.created_at).toBe(a.created_at);
    const list = await lib.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: a.id, title: 'Hymn, new words' });
    expect((await lib.get(b.id))!.data.composer).toBe('Me');
  });

  it('duplicates, deletes, and an untitled score gets a name', async () => {
    const lib = new LocalLibrary(memoryStore());
    const s = await lib.save({ ...newScore(), title: '  ' });
    expect(s.title).toBe('Untitled');
    const copy = await lib.duplicate(s.id);
    expect(copy!.title).toBe('Untitled (copy)');
    await lib.remove(s.id);
    expect((await lib.list()).map((x) => x.id)).toEqual([copy!.id]);
    expect(await lib.get(s.id)).toBeNull();
  });

  it('backs up everything into one file and adds it to another library', async () => {
    const lib = new LocalLibrary(memoryStore());
    await lib.save(newScore({ title: 'One' }));
    await lib.save(newScore({ title: 'Two' }));
    const file = await lib.exportAll();
    expect(LocalLibrary.isBackup(file)).toBe(true);
    expect(LocalLibrary.isBackup(JSON.stringify(newScore()))).toBe(false);

    const other = new LocalLibrary(memoryStore());
    await other.save(newScore({ title: 'Already here' }));
    expect(await other.importAll(file, isValidScore)).toBe(2);
    expect((await other.list()).map((s) => s.title).sort()).toEqual(['Already here', 'One', 'Two']);
    await expect(other.importAll('{"hello":1}', isValidScore)).rejects.toThrow('not a Pianissimo library backup');
  });
});
