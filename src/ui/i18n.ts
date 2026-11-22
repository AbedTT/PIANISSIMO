/**
 * Interface language for the editor's fixed chrome (menus, side panel, dialogs, status bar
 * labels). Strings are looked up by their English text, so the HTML stays readable and
 * untranslated strings simply stay in English. Command names in the shortcut list and
 * command search are not translated yet.
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
  ['Articulations', 'Articulations', 'Articulaciones', 'Artikulation'],
  ['Dynamics', 'Nuances', 'Dinámicas', 'Dynamik'],
];

const KEY = 'pianissimo:lang';
const dict = new Map<string, string[]>(TABLE.map((row) => [row[0], row]));
const INDEX: Record<Lang, number> = { en: 0, fr: 1, es: 2, de: 3 };

export function currentLang(): Lang {
  const saved = localStorage.getItem(KEY) as Lang | null;
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
  localStorage.setItem(KEY, lang);
  translatePage(document.body, lang);
}
