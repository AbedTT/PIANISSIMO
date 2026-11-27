// A stand-in for a sheet-music scanner (Audiveris), used by the tests:
//   node scripts/fake-omr.mjs <input file> <output folder>
// It checks it got the uploaded file and writes a small MusicXML score (C D E F) into a
// subfolder of the output folder, the way Audiveris does.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [input, out] = process.argv.slice(2);
if (!input || !existsSync(input) || !statSync(input).size) {
  console.error('fake-omr: no input');
  process.exit(2);
}
const note = (step) =>
  `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Scanned page</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${['C', 'D', 'E', 'F'].map(note).join('')}
    </measure>
  </part>
</score-partwise>`;
mkdirSync(join(out, 'page'), { recursive: true });
writeFileSync(join(out, 'page', 'page.musicxml'), xml);
