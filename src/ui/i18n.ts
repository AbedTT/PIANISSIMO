import { COMMAND_ROWS, INTERVAL_ROWS, LABEL_PATTERNS, SITE_BLOCKS, STATUS_ROWS } from './i18n-strings';
import { MESSAGE_PATTERNS, MESSAGE_ROWS } from './i18n-messages';
import { GUIDE_BLOCKS } from './i18n-guide';
import { LEGAL_BLOCKS } from './i18n-legal';

/**
 * Interface language for the editor (menus, side panel, dialogs, command names, status bar)
 * and the website. Strings are looked up by their English text, so the HTML stays readable
 * and untranslated strings simply stay in English. Website blocks with inline markup are
 * translated as a whole by their `data-i18n` name.
 */
export type Lang = 'en' | 'fr' | 'es' | 'de';

export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'de', name: 'Deutsch' },
];

// [English, French, Spanish, German]
const TABLE: [string, string, string, string][] = [
  ['New', 'Nouveau', 'Nuevo', 'Neu'],
  ['Open', 'Ouvrir', 'Abrir', 'Öffnen'],
  ['Save', 'Enregistrer', 'Guardar', 'Speichern'],
  ['Export ▾', 'Exporter ▾', 'Exportar ▾', 'Exportieren ▾'],
  ['Pianissimo file (.json backup)', 'Fichier Pianissimo (sauvegarde .json)', 'Archivo Pianissimo (copia .json)', 'Pianissimo-Datei (.json-Sicherung)'],
  ['Audio (.wav)', 'Audio (.wav)', 'Audio (.wav)', 'Audio (.wav)'],
  ['Image (.png)', 'Image (.png)', 'Imagen (.png)', 'Bild (.png)'],
  ['Image (.svg)', 'Image (.svg)', 'Imagen (.svg)', 'Bild (.svg)'],
  ['PDF / Print', 'PDF / Imprimer', 'PDF / Imprimir', 'PDF / Drucken'],
  ['⇪ Share', '⇪ Partager', '⇪ Compartir', '⇪ Teilen'],
  ['▤ My scores', '▤ Mes partitions', '▤ Mis partituras', '▤ Meine Noten'],
  ['My scores', 'Mes partitions', 'Mis partituras', 'Meine Noten'],
  ['Sign in', 'Se connecter', 'Iniciar sesión', 'Anmelden'],
  ['Sign out', 'Se déconnecter', 'Cerrar sesión', 'Abmelden'],
  ['Download my data', 'Télécharger mes données', 'Descargar mis datos', 'Meine Daten herunterladen'],
  ['Delete my account…', 'Supprimer mon compte…', 'Eliminar mi cuenta…', 'Mein Konto löschen…'],
  ['Score setup', 'Réglages de la partition', 'Configuración', 'Partitur-Einstellungen'],
  ['Key signature', 'Armure', 'Armadura', 'Tonart'],
  ['Time signature', 'Mesure', 'Compás', 'Taktart'],
  ['Staves', 'Portées', 'Pentagramas', 'Notensysteme'],
  ['Piano (grand staff)', 'Piano (double portée)', 'Piano (sistema doble)', 'Klavier (Akkolade)'],
  ['Treble staff', 'Clé de sol', 'Clave de sol', 'Violinschlüssel'],
  ['Bass staff', 'Clé de fa', 'Clave de fa', 'Bassschlüssel'],
  ['Alto staff', "Clé d'ut 3", 'Clave de do', 'Altschlüssel'],
  ['Two treble staves', 'Deux portées en clé de sol', 'Dos pentagramas en sol', 'Zwei Violinsysteme'],
  ['🎻 Instruments…', '🎻 Instruments…', '🎻 Instrumentos…', '🎻 Instrumente…'],
  ['Transposed score (as players read it)', 'Partition transposée (comme les musiciens la lisent)', 'Partitura transpuesta (como la leen los músicos)', 'Transponierte Partitur (wie die Spieler lesen)'],
  ['Sounds', 'Sons', 'Sonidos', 'Klänge'],
  ['Chord accompaniment', "Accompagnement d'accords", 'Acompañamiento de acordes', 'Akkordbegleitung'],
  ['Play the chord symbols', 'Jouer les accords', 'Tocar los acordes', 'Akkordsymbole spielen'],
  ['Style', 'Style', 'Estilo', 'Stil'],
  ['Sound', 'Son', 'Sonido', 'Klang'],
  ['+ Add bar', '+ Ajouter une mesure', '+ Añadir compás', '+ Takt hinzufügen'],
  ['− Delete bar', '− Supprimer la mesure', '− Borrar compás', '− Takt löschen'],
  ['Quick start', 'Démarrage rapide', 'Inicio rápido', 'Schnellstart'],
  ['View', 'Affichage', 'Vista', 'Ansicht'],
  ['Theme', 'Thème', 'Tema', 'Design'],
  ['Automatic', 'Automatique', 'Automático', 'Automatisch'],
  ['Light', 'Clair', 'Claro', 'Hell'],
  ['Dark', 'Sombre', 'Oscuro', 'Dunkel'],
  ['Language', 'Langue', 'Idioma', 'Sprache'],
  ['On-screen keyboard', 'Clavier à l’écran', 'Teclado en pantalla', 'Bildschirmklaviatur'],
  ['Start the tutorial', 'Lancer le tutoriel', 'Empezar el tutorial', 'Tutorial starten'],
  ['Keyboard shortcuts', 'Raccourcis clavier', 'Atajos de teclado', 'Tastenkürzel'],
  ['New score', 'Nouvelle partition', 'Nueva partitura', 'Neue Partitur'],
  ['Start from a template', 'Partir d’un modèle', 'Empezar con una plantilla', 'Mit einer Vorlage beginnen'],
  ['Or set it up yourself', 'Ou configurez-la vous-même', 'O configúrala tú mismo', 'Oder selbst einrichten'],
  ['Title', 'Titre', 'Título', 'Titel'],
  ['Composer', 'Compositeur', 'Compositor', 'Komponist'],
  ['Instrument', 'Instrument', 'Instrumento', 'Instrument'],
  ['Key', 'Tonalité', 'Tonalidad', 'Tonart'],
  ['Time', 'Mesure', 'Compás', 'Takt'],
  ['Tempo', 'Tempo', 'Tempo', 'Tempo'],
  ['Bars', 'Mesures', 'Compases', 'Takte'],
  ['Create score', 'Créer la partition', 'Crear partitura', 'Partitur erstellen'],
  ['Transpose', 'Transposer', 'Transportar', 'Transponieren'],
  ['Comments', 'Commentaires', 'Comentarios', 'Kommentare'],
  ['Add comment', 'Ajouter un commentaire', 'Añadir comentario', 'Kommentar hinzufügen'],
  ['Version history', 'Historique des versions', 'Historial de versiones', 'Versionsverlauf'],
  ['Bar', 'Mesure', 'Compás', 'Takt'],
  ['Staff', 'Portée', 'Pentagrama', 'System'],
  ['At cursor', 'Au curseur', 'En el cursor', 'Am Cursor'],
  ['Input', 'Saisie', 'Entrada', 'Eingabe'],
  ['Mode', 'Mode', 'Modo', 'Modus'],
  ['Notes', 'Notes', 'Notas', 'Noten'],
  ['Tune, meter… (optional)', 'Air, mètre… (facultatif)', 'Melodía, métrica… (opcional)', 'Melodie, Versmaß … (optional)'],
  ['Tune, meter or other note (top left)', 'Air, mètre ou autre note (en haut à gauche)', 'Melodía, métrica u otra nota (arriba a la izquierda)', 'Melodie, Versmaß oder andere Notiz (oben links)'],
  ['Footer (optional): a scripture it is based on, a dedication, where the idea came from…', 'Pied de page (facultatif) : le texte biblique de référence, une dédicace, l’origine de l’idée…', 'Pie de página (opcional): el texto bíblico en que se basa, una dedicatoria, de dónde vino la idea…', 'Fußzeile (optional): die zugrunde liegende Bibelstelle, eine Widmung, woher die Idee kam …'],
  ['Footer note', 'Note de bas de page', 'Nota al pie', 'Fußnotiz'],
  ['🎶 Combine voices into chords', '🎶 Réunir les voix en accords', '🎶 Unir las voces en acordes', '🎶 Stimmen zu Akkorden zusammenfassen'],
  ['Where voice 2 moves with voice 1, put both on one stem (soprano + alto, tenor + bass). Select bars first to limit it to them.', 'Là où la voix 2 suit le rythme de la voix 1, les deux partagent une hampe (soprano + alto, ténor + basse). Sélectionnez des mesures pour vous y limiter.', 'Donde la voz 2 sigue el ritmo de la voz 1, ambas comparten plica (soprano + contralto, tenor + bajo). Seleccione compases para limitarlo a ellos.', 'Wo Stimme 2 im Rhythmus von Stimme 1 geht, teilen sich beide einen Hals (Sopran + Alt, Tenor + Bass). Takte auswählen, um es darauf zu beschränken.'],
  ['Score settings', 'Réglages de la partition', 'Ajustes de la partitura', 'Partitur-Einstellungen'],
  ['Show or hide the score settings', 'Afficher ou masquer les réglages', 'Mostrar u ocultar los ajustes', 'Einstellungen ein- oder ausblenden'],
  ['Done', 'OK', 'Listo', 'Fertig'],
  ['Cancel', 'Annuler', 'Cancelar', 'Abbrechen'],
  ['More', 'Plus', 'Más', 'Mehr'],
  ['Articulations', 'Articulations', 'Articulaciones', 'Artikulation'],
  ['Dynamics', 'Nuances', 'Dinámicas', 'Dynamik'],
];

const KEY = 'pianissimo:lang';
const dict = new Map<string, string[]>([...TABLE, ...COMMAND_ROWS, ...STATUS_ROWS, ...INTERVAL_ROWS].map((row) => [row[0], row]));
const messages = new Map<string, string[]>(MESSAGE_ROWS.map((row) => [row[0], row]));
const INDEX: Record<Lang, number> = { en: 0, fr: 1, es: 2, de: 3 };

export function currentLang(): Lang {
  let saved: Lang | null = null;
  try {
    saved = localStorage.getItem(KEY) as Lang | null;
  } catch {
    /* storage blocked */
  }
  if (saved && saved in INDEX) return saved;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2) as Lang;
  return nav in INDEX ? nav : 'en';
}

/** Translate one English string into the current language (unknown strings stay English). */
export function t(english: string, lang = currentLang()): string {
  return dict.get(english)?.[INDEX[lang]] ?? english;
}

// original English text of every translated text node / attribute, so we can switch back
const originalText = new WeakMap<Text, string>();
const ATTRS = ['title', 'placeholder', 'aria-label'] as const;

/** Translate the fixed text under `root` in place. */
export function translatePage(root: HTMLElement = document.body, lang = currentLang()) {
  document.documentElement.lang = lang;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const parent = n.parentElement;
    if (!parent || parent.closest('#score, script, style, #status, #toolbar')) continue;
    const english = originalText.get(n) ?? n.data.trim();
    if (!dict.has(english)) continue;
    originalText.set(n, english);
    const lead = n.data.match(/^\s*/)![0];
    const tail = n.data.match(/\s*$/)![0];
    n.data = lead + t(english, lang) + tail;
  }
  root.querySelectorAll<HTMLElement>('[title], [placeholder], [aria-label]').forEach((el) => {
    for (const a of ATTRS) {
      const value = el.getAttribute(a);
      if (value === null) continue;
      const store = `data-en-${a}`;
      const english = el.getAttribute(store) ?? value;
      if (!dict.has(english)) continue;
      el.setAttribute(store, english);
      el.setAttribute(a, t(english, lang));
    }
  });
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  translatePage(document.body, lang);
}

/** A command label in the current language, including labels built from a template ("Write C"). */
export function tLabel(english: string, lang = currentLang()): string {
  if (lang === 'en') return english;
  const direct = dict.get(english)?.[INDEX[lang]];
  if (direct) return direct;
  for (const { re, to } of LABEL_PATTERNS) {
    const m = re.exec(english);
    if (m) return to[INDEX[lang] - 1].replace('$1', t(m[1], lang));
  }
  return english;
}

/** A website block by name; English comes from the page (or the fallback given). */
export function siteText(key: string, english: string, lang = currentLang()): string {
  if (lang === 'en') return english;
  return (SITE_BLOCKS[key] ?? GUIDE_BLOCKS[key] ?? LEGAL_BLOCKS[key])?.[INDEX[lang] - 1] ?? english;
}

const originalHtml = new WeakMap<Element, string>();

/** Translate every `[data-i18n]` block (and `data-i18n-placeholder` inputs) under `root`. */
export function translateSite(root: ParentNode = document, lang = currentLang()) {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    if (!originalHtml.has(el)) originalHtml.set(el, el.innerHTML);
    el.innerHTML = siteText(el.dataset.i18n!, originalHtml.get(el)!, lang);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    if (!el.dataset.enPlaceholder) el.dataset.enPlaceholder = el.placeholder;
    el.placeholder = siteText(el.dataset.i18nPlaceholder!, el.dataset.enPlaceholder, lang);
  });
}

/**
 * A toast or screen-reader message in the current language: a known message, or one built
 * from a known template (its titles, names and numbers are kept). Anything else stays English.
 */
export function tMsg(english: string, lang = currentLang()): string {
  if (lang === 'en') return english;
  const i = INDEX[lang];
  const known = messages.get(english)?.[i] ?? dict.get(english)?.[i];
  if (known) return known;
  for (const { re, to } of MESSAGE_PATTERNS) {
    const m = re.exec(english);
    if (m) return to[i - 1].replace(/\$(\d)/g, (_, k) => m[Number(k)] ?? '');
  }
  return english;
}
