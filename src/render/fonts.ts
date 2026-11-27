import { Font, VexFlow } from 'vexflow/core';
import { academico, academicoBold, bravura } from 'virtual:vexflow-fonts';

/**
 * The two fonts the score uses: Bravura for the music, Academico for text. They load in the
 * background; pages redraw on `document.fonts.ready` (VexFlow measures glyphs with them).
 * Where fonts cannot load (tests, very old browsers) VexFlow falls back to its metrics.
 */
export const FONT_URLS = { Bravura: bravura, Academico: academico } as const;

const quiet = () => {};
void Font.load('Bravura', bravura, { display: 'block' }).catch(quiet);
void Font.load('Academico', academico, { display: 'swap' }).catch(quiet);
void Font.load('Academico', academicoBold, { display: 'swap', weight: 'bold' }).catch(quiet);
VexFlow.setFonts('Bravura', 'Academico');
