/**
 * The guide's explanations (guide.html), by `data-i18n` key: [French, Spanish, German] HTML.
 * Key names, link targets and <kbd> keys match the English page.
 */
const K = (k: string) => `<kbd>${k}</kbd>`;

export const GUIDE_BLOCKS: Record<string, [string, string, string]> = {
  'gp.start.1': [
    `Ouvrez l’<a href="app.html">éditeur</a>. Un cadre bleu, le <b>curseur</b>, se trouve sur le premier temps. Tout ce que vous tapez se passe au curseur, et le curseur avance tout seul.`,
    `Abre el <a href="app.html">editor</a>. Un recuadro azul, el <b>cursor</b>, está en el primer tiempo. Todo lo que escribes ocurre en el cursor, y el cursor avanza solo.`,
    `Öffnen Sie den <a href="app.html">Editor</a>. Ein blauer Rahmen, der <b>Cursor</b>, steht auf dem ersten Schlag. Alles, was Sie tippen, passiert am Cursor, und der Cursor rückt von selbst weiter.`,
  ],
  'gp.start.2': [
    `Cliquez sur <b>Nouveau</b> pour choisir un instrument (piano, voix + piano, grille d’accords, violon…), une tonalité, une mesure et un tempo. Vous pourrez tout changer plus tard dans le panneau <b>Réglages de la partition</b> à droite.`,
    `Pulsa <b>Nuevo</b> para elegir un instrumento (piano, voz + piano, lead sheet, violín…), una tonalidad, un compás y un tempo. Puedes cambiarlo todo más tarde en el panel <b>Configuración</b> de la derecha.`,
    `Klicken Sie auf <b>Neu</b>, um ein Instrument (Klavier, Gesang + Klavier, Leadsheet, Violine…), eine Tonart, eine Taktart und ein Tempo zu wählen. Alles lässt sich später im Bereich <b>Partitur-Einstellungen</b> rechts ändern.`,
  ],
  'gp.notes.1': [
    `<li><b>Choisissez une durée</b> : ${K('1')} ronde, ${K('2')} blanche, ${K('3')} noire, ${K('4')} croche, ${K('5')} double croche, ${K('6')} triple croche, ${K('7')} quadruple croche. ${K('.')} la rend pointée.</li>
     <li><b>Tapez la note</b> avec ${K('A')}–${K('G')}. Pianissimo choisit l’octave la plus proche de la note précédente, pour que les mélodies coulent naturellement.</li>
     <li>Continuez à taper. Quand une mesure est pleine, le curseur passe à la suivante, et une mesure est ajoutée à la fin quand il le faut.</li>`,
    `<li><b>Elige una duración</b>: ${K('1')} redonda, ${K('2')} blanca, ${K('3')} negra, ${K('4')} corchea, ${K('5')} semicorchea, ${K('6')} fusa, ${K('7')} semifusa. ${K('.')} le añade puntillo.</li>
     <li><b>Escribe la nota</b> con ${K('A')}–${K('G')}. Pianissimo elige la octava más cercana a la nota anterior, así las melodías fluyen con naturalidad.</li>
     <li>Sigue escribiendo. Cuando un compás se llena, el cursor pasa al siguiente, y se añade un compás al final cuando hace falta.</li>`,
    `<li><b>Notenwert wählen</b>: ${K('1')} Ganze, ${K('2')} Halbe, ${K('3')} Viertel, ${K('4')} Achtel, ${K('5')} Sechzehntel, ${K('6')} Zweiunddreißigstel, ${K('7')} Vierundsechzigstel. ${K('.')} punktiert sie.</li>
     <li><b>Note tippen</b> mit ${K('A')}–${K('G')}. Pianissimo wählt die Oktave, die der vorigen Note am nächsten liegt, so fließen Melodien ganz natürlich.</li>
     <li>Einfach weitertippen. Ist ein Takt voll, geht der Cursor in den nächsten, und am Ende kommt bei Bedarf ein neuer Takt hinzu.</li>`,
  ],
  'gp.notes.2': [
    `Une note trop longue pour la place restante dans la mesure est coupée à la barre de mesure et liée, pour que le rythme ne soit jamais tronqué. Vous pouvez aussi appuyer sur ${K('I')} et cliquer sur la portée pour placer des notes à la souris.`,
    `Una nota demasiado larga para el espacio que queda en el compás se divide en la barra de compás y se liga, así el ritmo nunca se corta. También puedes pulsar ${K('I')} y hacer clic en el pentagrama para poner notas con el ratón.`,
    `Eine Note, die für den Rest des Takts zu lang ist, wird am Taktstrich geteilt und übergebunden, damit der Rhythmus nie abgeschnitten wird. Mit ${K('I')} und einem Klick ins System setzen Sie Noten auch mit der Maus.`,
  ],
  'gp.notes.3': [
    `<b>Accords</b> : ${K('Maj')}+${K('A')}–${K('G')} ajoute une note au-dessus de la précédente ; ${K('Alt')}+${K('2')}…${K('8')} ajoute un intervalle (une tierce, c’est ${K('Alt')}+${K('3')}).`,
    `<b>Acordes</b>: ${K('Mayús')}+${K('A')}–${K('G')} añade una nota encima de la anterior; ${K('Alt')}+${K('2')}…${K('8')} añade un intervalo (una tercera es ${K('Alt')}+${K('3')}).`,
    `<b>Akkorde</b>: ${K('Umschalt')}+${K('A')}–${K('G')} fügt eine Note über der letzten hinzu; ${K('Alt')}+${K('2')}…${K('8')} fügt ein Intervall hinzu (eine Terz ist ${K('Alt')}+${K('3')}).`,
  ],
  'gp.notes.4': [
    `<b>Clavier MIDI</b> : cliquez sur <b>🎹 MIDI</b> (ou ${K('Maj')}+${K('M')}) et jouez ; les touches enfoncées ensemble forment un accord. Fonctionne dans Chrome et Edge.`,
    `<b>Teclado MIDI</b>: pulsa <b>🎹 MIDI</b> (o ${K('Mayús')}+${K('M')}) y toca; las teclas pulsadas a la vez forman un acorde. Funciona en Chrome y Edge.`,
    `<b>MIDI-Keyboard</b>: auf <b>🎹 MIDI</b> klicken (oder ${K('Umschalt')}+${K('M')}) und spielen; gleichzeitig gedrückte Tasten werden ein Akkord. Funktioniert in Chrome und Edge.`,
  ],
  'gp.editing.1': [
    `<li>${K('↑')} ${K('↓')} déplacent une note d’un degré ; ${K('Ctrl')}+${K('↑')} ${K('↓')} d’une octave ; ${K('Alt')}+${K('Maj')}+${K('↑')} ${K('↓')} d’un demi-ton.</li>
     <li>${K('=')} dièse, ${K('-')} bémol, ${K('N')} bécarre (appuyez de nouveau pour annuler) ; ${K('J')} change l’enharmonie (C♯ ↔ D♭).</li>
     <li>Placez-vous sur une note avec ${K('←')} ${K('→')} et appuyez sur une touche de durée pour la changer.</li>
     <li>${K('Suppr')} transforme une note en silence ; ${K('Ctrl')}+${K('Z')} / ${K('Ctrl')}+${K('Y')} annulent et rétablissent.</li>
     <li>${K('Alt')}+${K('T')} transpose toute la partition (armure et accords compris) ou seulement la sélection.</li>`,
    `<li>${K('↑')} ${K('↓')} mueven una nota un grado; ${K('Ctrl')}+${K('↑')} ${K('↓')} una octava; ${K('Alt')}+${K('Mayús')}+${K('↑')} ${K('↓')} un semitono.</li>
     <li>${K('=')} sostenido, ${K('-')} bemol, ${K('N')} becuadro (pulsa otra vez para quitarlo); ${K('J')} cambia la enarmonía (C♯ ↔ D♭).</li>
     <li>Ve a una nota con ${K('←')} ${K('→')} y pulsa una tecla de duración para cambiarla.</li>
     <li>${K('Supr')} convierte una nota en silencio; ${K('Ctrl')}+${K('Z')} / ${K('Ctrl')}+${K('Y')} deshacen y rehacen.</li>
     <li>${K('Alt')}+${K('T')} transporta toda la partitura (armadura y cifrados incluidos) o solo la selección.</li>`,
    `<li>${K('↑')} ${K('↓')} verschieben eine Note um eine Stufe; ${K('Strg')}+${K('↑')} ${K('↓')} um eine Oktave; ${K('Alt')}+${K('Umschalt')}+${K('↑')} ${K('↓')} um einen Halbton.</li>
     <li>${K('=')} Kreuz, ${K('-')} Be, ${K('N')} Auflösungszeichen (nochmals drücken hebt es auf); ${K('J')} verwechselt enharmonisch (C♯ ↔ D♭).</li>
     <li>Mit ${K('←')} ${K('→')} auf eine Note gehen und eine Notenwert-Taste drücken, um ihre Dauer zu ändern.</li>
     <li>${K('Entf')} macht aus einer Note eine Pause; ${K('Strg')}+${K('Z')} / ${K('Strg')}+${K('Y')} machen rückgängig und wiederholen.</li>
     <li>${K('Alt')}+${K('T')} transponiert die ganze Partitur (mit Vorzeichen und Akkordsymbolen) oder nur die Auswahl.</li>`,
  ],
  'gp.rhythm.1': [
    `${K('0')} écrit un silence. ${K(',')} lie une note à la suivante. ${K('Maj')}+${K('3')} active ou désactive la saisie en triolets : trois croches de triolet remplissent un temps. ${K('S')} ajoute une liaison jusqu’à la note suivante, ou sur les notes sélectionnées. Les silences restants sont rangés automatiquement en valeurs nettes, alignées sur les temps.`,
    `${K('0')} escribe un silencio. ${K(',')} liga una nota a la siguiente. ${K('Mayús')}+${K('3')} activa o desactiva la entrada en tresillos: tres corcheas de tresillo llenan un tiempo. ${K('S')} añade una ligadura de expresión a la nota siguiente o sobre las notas seleccionadas. Los silencios sobrantes se ordenan solos en valores limpios, alineados con los tiempos.`,
    `${K('0')} schreibt eine Pause. ${K(',')} bindet eine Note an die nächste. ${K('Umschalt')}+${K('3')} schaltet die Trioleneingabe an oder aus: drei Triolenachtel füllen einen Schlag. ${K('S')} setzt einen Bindebogen zur nächsten Note oder über die ausgewählten Noten. Übrige Pausen werden automatisch zu sauberen, schlaggerechten Werten zusammengefasst.`,
  ],
  'gp.voices.1': [
    `Appuyez sur ${K('V')} pour écrire une autre ligne indépendante sur la même portée : une mélodie tenue au-dessus de notes intérieures qui bougent, ou soprano et alto ensemble. ${K('V')} passe par les voix 1, 2, 3 et 4. Les voix 1 et 3 ont les hampes en haut, 2 et 4 en bas, et chacune a sa couleur de curseur. ${K('Ctrl')}+${K('Maj')}+${K('V')} retire de la mesure la voix où vous êtes.`,
    `Pulsa ${K('V')} para escribir otra línea independiente en el mismo pentagrama: una melodía larga sobre notas interiores que se mueven, o soprano y contralto juntas. ${K('V')} recorre las voces 1, 2, 3 y 4. Las voces 1 y 3 tienen las plicas hacia arriba, la 2 y la 4 hacia abajo, y cada una tiene su color de cursor. ${K('Ctrl')}+${K('Mayús')}+${K('V')} quita del compás la voz en la que estás.`,
    `Mit ${K('V')} schreiben Sie eine weitere eigenständige Linie im selben System: eine gehaltene Melodie über bewegten Mittelstimmen, oder Sopran und Alt zusammen. ${K('V')} geht durch die Stimmen 1, 2, 3 und 4. Stimmen 1 und 3 haben Hälse nach oben, 2 und 4 nach unten, und jede hat ihre eigene Cursorfarbe. ${K('Strg')}+${K('Umschalt')}+${K('V')} entfernt die Stimme, auf der Sie sind, aus dem Takt.`,
  ],
  'gp.selection.1': [
    `Maintenez ${K('Maj')} avec les flèches (ou ${K('Maj')}+clic) pour sélectionner. ${K('Ctrl')}+${K('Maj')}+${K('→')} sélectionne mesure par mesure ; ${K('Ctrl')}+${K('A')} sélectionne tout. Ensuite ${K('Ctrl')}+${K('C')}, ${K('Ctrl')}+${K('X')}, ${K('Ctrl')}+${K('V')}, ${K('Suppr')}, ou transposez avec les flèches.`,
    `Mantén ${K('Mayús')} con las flechas (o ${K('Mayús')}+clic) para seleccionar. ${K('Ctrl')}+${K('Mayús')}+${K('→')} selecciona compás a compás; ${K('Ctrl')}+${K('A')} lo selecciona todo. Luego ${K('Ctrl')}+${K('C')}, ${K('Ctrl')}+${K('X')}, ${K('Ctrl')}+${K('V')}, ${K('Supr')}, o transporta con las flechas.`,
    `${K('Umschalt')} mit den Pfeiltasten (oder ${K('Umschalt')}+Klick) wählt aus. ${K('Strg')}+${K('Umschalt')}+${K('→')} wählt taktweise; ${K('Strg')}+${K('A')} wählt alles. Dann ${K('Strg')}+${K('C')}, ${K('Strg')}+${K('X')}, ${K('Strg')}+${K('V')}, ${K('Entf')}, oder mit den Pfeiltasten transponieren.`,
  ],
  'gp.expression.1': [
    `Appuyez sur ${K('Tab')} pour changer la rangée des chiffres : dans l’onglet <b>Articulations</b>, ${K('1')}–${K('5')} sont staccato, accent, tenuto, marcato et point d’orgue ; dans l’onglet <b>Nuances</b>, ${K('1')}–${K('9')} vont de <i>ppp</i> à <i>sfz</i>. ${K('Échap')} revient aux notes. Les nuances et les accents changent aussi le volume à la lecture.`,
    `Pulsa ${K('Tab')} para cambiar la fila de números: en la pestaña <b>Articulaciones</b>, ${K('1')}–${K('5')} son staccato, acento, tenuto, marcato y calderón; en la pestaña <b>Dinámicas</b>, ${K('1')}–${K('9')} van de <i>ppp</i> a <i>sfz</i>. ${K('Esc')} vuelve a las notas. Las dinámicas y los acentos también cambian el volumen al reproducir.`,
    `${K('Tab')} wechselt die Zahlenreihe: im Reiter <b>Artikulation</b> sind ${K('1')}–${K('5')} Staccato, Akzent, Tenuto, Marcato und Fermate; im Reiter <b>Dynamik</b> gehen ${K('1')}–${K('9')} von <i>ppp</i> bis <i>sfz</i>. ${K('Esc')} führt zurück zu den Noten. Dynamik und Akzente ändern auch die Lautstärke bei der Wiedergabe.`,
  ],
  'gp.lyrics.1': [
    `Placez le curseur sur la première note et appuyez sur ${K('Ctrl')}+${K('L')}. Tapez une syllabe, puis :`,
    `Pon el cursor en la primera nota y pulsa ${K('Ctrl')}+${K('L')}. Escribe una sílaba y luego:`,
    `Cursor auf die erste Note setzen und ${K('Strg')}+${K('L')} drücken. Eine Silbe tippen, dann:`,
  ],
  'gp.lyrics.2': [
    `<tr><th>Touche</th><th>Effet</th></tr>
     <tr><td>${K('Espace')}</td><td>Note suivante (les silences sont sautés)</td></tr>
     <tr><td>${K('-')}</td><td>Trait d’union vers la syllabe suivante du mot</td></tr>
     <tr><td>${K('↓')} / ${K('↑')}</td><td>Couplet suivant / précédent sous la même note</td></tr>
     <tr><td>${K('Retour arrière')} dans une case vide</td><td>Recule d’une note</td></tr>
     <tr><td>${K('Entrée')}</td><td>Terminé</td></tr>`,
    `<tr><th>Tecla</th><th>Hace</th></tr>
     <tr><td>${K('Espacio')}</td><td>Nota siguiente (se saltan los silencios)</td></tr>
     <tr><td>${K('-')}</td><td>Guion hacia la siguiente sílaba de la palabra</td></tr>
     <tr><td>${K('↓')} / ${K('↑')}</td><td>Estrofa siguiente / anterior bajo la misma nota</td></tr>
     <tr><td>${K('Retroceso')} en una casilla vacía</td><td>Retrocede una nota</td></tr>
     <tr><td>${K('Intro')}</td><td>Listo</td></tr>`,
    `<tr><th>Taste</th><th>Wirkung</th></tr>
     <tr><td>${K('Leertaste')}</td><td>Nächste Note (Pausen werden übersprungen)</td></tr>
     <tr><td>${K('-')}</td><td>Bindestrich zur nächsten Silbe des Worts</td></tr>
     <tr><td>${K('↓')} / ${K('↑')}</td><td>Nächste / vorige Strophe unter derselben Note</td></tr>
     <tr><td>${K('Rücktaste')} in einem leeren Feld</td><td>Eine Note zurück</td></tr>
     <tr><td>${K('Eingabe')}</td><td>Fertig</td></tr>`,
  ],
  'gp.chords.1': [
    `${K('Ctrl')}+${K('K')} saisit des accords au-dessus de la portée : <code>C</code>, <code>Am7</code>, <code>F#m7b5</code>, <code>Bbmaj7</code>, <code>G/B</code>… ${K('Espace')} passe à la note ou au silence suivant.`,
    `${K('Ctrl')}+${K('K')} escribe cifrados sobre el pentagrama: <code>C</code>, <code>Am7</code>, <code>F#m7b5</code>, <code>Bbmaj7</code>, <code>G/B</code>… ${K('Espacio')} pasa a la nota o silencio siguiente.`,
    `${K('Strg')}+${K('K')} tippt Akkordsymbole über das System: <code>C</code>, <code>Am7</code>, <code>F#m7b5</code>, <code>Bbmaj7</code>, <code>G/B</code>… Die ${K('Leertaste')} geht zur nächsten Note oder Pause.`,
  ],
  'gp.chords.2': [
    `Activez <b>Accompagnement d’accords</b> (${K('Alt')}+${K('A')}, ou dans le panneau latéral) et les accords sont joués comme par un groupe, dans l’un des cinq styles, avec son propre instrument.`,
    `Activa <b>Acompañamiento de acordes</b> (${K('Alt')}+${K('A')}, o en el panel lateral) y los acordes suenan como una banda de acompañamiento en uno de cinco estilos, con su propio instrumento.`,
    `Schalten Sie die <b>Akkordbegleitung</b> ein (${K('Alt')}+${K('A')} oder im Seitenbereich), dann spielen die Akkorde wie eine Begleitband in einem von fünf Stilen, mit eigenem Instrument.`,
  ],
  'gp.bars.1': [
    `<li>${K('[')} et ${K(']')} commencent et terminent une reprise ; ${K('Ctrl')}+${K(']')} marque les 1re et 2e fins.</li>
     <li>Le menu <b>𝄋</b> de la barre d’outils ajoute Segno, Coda, Fine, Vers la Coda, D.C. et D.S. (al Fine / al Coda). La lecture suit chaque saut.</li>
     <li>${K('Alt')}+${K('Entrée')} insère une mesure ; ${K('Ctrl')}+${K('Retour arrière')} en supprime une.</li>`,
    `<li>${K('[')} y ${K(']')} empiezan y terminan una repetición; ${K('Ctrl')}+${K(']')} marca las casillas de 1.ª y 2.ª.</li>
     <li>El menú <b>𝄋</b> de la barra de herramientas añade Segno, Coda, Fine, Al Coda, D.C. y D.S. (al Fine / al Coda). La reproducción sigue cada salto.</li>
     <li>${K('Alt')}+${K('Intro')} inserta un compás; ${K('Ctrl')}+${K('Retroceso')} borra uno.</li>`,
    `<li>${K('[')} und ${K(']')} beginnen und beenden eine Wiederholung; ${K('Strg')}+${K(']')} setzt 1. und 2. Klammer.</li>
     <li>Das Menü <b>𝄋</b> in der Werkzeugleiste fügt Segno, Coda, Fine, Zur Coda, D.C. und D.S. (al Fine / al Coda) hinzu. Die Wiedergabe folgt jedem Sprung.</li>
     <li>${K('Alt')}+${K('Eingabe')} fügt einen Takt ein; ${K('Strg')}+${K('Rücktaste')} löscht einen.</li>`,
  ],
  'gp.sound.1': [
    `${K('Espace')} joue à partir de la mesure du curseur, ${K('Ctrl')}+${K('Espace')} depuis le début. Avec des notes sélectionnées, ${K('Espace')} ne joue que la sélection ; ${K('L')} la met en boucle. ${K('Alt')}+${K('M')} active le métronome, ${K('Alt')}+${K('C')} ajoute une mesure de décompte. Choisissez l’instrument de chaque portée sous <b>Sons</b>.`,
    `${K('Espacio')} reproduce desde el compás del cursor, ${K('Ctrl')}+${K('Espacio')} desde el principio. Con notas seleccionadas, ${K('Espacio')} reproduce solo la selección; ${K('L')} la repite en bucle. ${K('Alt')}+${K('M')} activa el metrónomo, ${K('Alt')}+${K('C')} añade un compás de entrada. Elige el instrumento de cada pentagrama en <b>Sonidos</b>.`,
    `Die ${K('Leertaste')} spielt ab dem Takt des Cursors, ${K('Strg')}+${K('Leertaste')} von vorne. Mit ausgewählten Noten spielt die ${K('Leertaste')} nur die Auswahl; ${K('L')} wiederholt sie in Schleife. ${K('Alt')}+${K('M')} schaltet das Metronom ein, ${K('Alt')}+${K('C')} fügt einen Takt Einzähler hinzu. Das Instrument jedes Systems wählen Sie unter <b>Klänge</b>.`,
  ],
  'gp.print.1': [
    `${K('Ctrl')}+${K('P')} ouvre l’aperçu des pages : choisissez A4 ou US Letter et une taille de portée, puis <b>Imprimer / PDF</b> et choisissez <i>Enregistrer au format PDF</i> pour obtenir un fichier. ${K('Ctrl')}+${K('Entrée')} force un retour à la ligne après une mesure ; ${K('Ctrl')}+${K('Alt')}+${K('Entrée')} commence une nouvelle page.`,
    `${K('Ctrl')}+${K('P')} abre la vista previa de páginas: elige A4 o US Letter y un tamaño de pentagrama, luego <b>Imprimir / Guardar PDF</b> y elige <i>Guardar como PDF</i> para obtener un archivo. ${K('Ctrl')}+${K('Intro')} fuerza una línea nueva tras un compás; ${K('Ctrl')}+${K('Alt')}+${K('Intro')} empieza una página nueva.`,
    `${K('Strg')}+${K('P')} öffnet die Seitenvorschau: A4 oder US Letter und eine Systemgröße wählen, dann <b>Drucken / PDF speichern</b> und <i>Als PDF speichern</i> für eine Datei. ${K('Strg')}+${K('Eingabe')} erzwingt eine neue Zeile nach einem Takt; ${K('Strg')}+${K('Alt')}+${K('Eingabe')} beginnt eine neue Seite.`,
  ],
  'gp.files.1': [
    `<li><b>Enregistrement automatique</b> : la partition en cours est conservée dans ce navigateur.</li>
     <li><b>Votre bibliothèque</b> : connectez-vous (gratuit) et ${K('Ctrl')}+${K('S')} enregistre dans <b>Mes partitions</b>, pour les rouvrir sur n’importe quel ordinateur.</li>
     <li><b>Partager</b> : rendez une partition <i>non répertoriée</i> (seulement les personnes qui ont le lien) ou <i>publique</i> (listée dans <a href="explore.html">Partitions partagées</a>). Le lien ouvre une page où chacun peut la voir et l’écouter.</li>
     <li><b>Fichiers</b> : ouvrez et exportez du MusicXML (<code>.musicxml</code>, <code>.mxl</code>) pour travailler avec MuseScore, Flat, Finale, Sibelius et Dorico. Vous pouvez aussi exporter en MIDI et télécharger une sauvegarde <code>.pianissimo.json</code>.</li>`,
    `<li><b>Guardado automático</b>: la partitura en la que trabajas se conserva en este navegador.</li>
     <li><b>Tu biblioteca</b>: inicia sesión (gratis) y ${K('Ctrl')}+${K('S')} guarda en <b>Mis partituras</b>, para abrirlas en cualquier ordenador.</li>
     <li><b>Compartir</b>: haz una partitura <i>no listada</i> (solo quien tenga el enlace) o <i>pública</i> (en <a href="explore.html">Explorar partituras</a>). El enlace abre una página donde cualquiera puede verla y escucharla.</li>
     <li><b>Archivos</b>: abre y exporta MusicXML (<code>.musicxml</code>, <code>.mxl</code>) para trabajar con MuseScore, Flat, Finale, Sibelius y Dorico. También puedes exportar MIDI y descargar una copia <code>.pianissimo.json</code>.</li>`,
    `<li><b>Automatisches Speichern</b>: die aktuelle Partitur bleibt in diesem Browser.</li>
     <li><b>Ihre Bibliothek</b>: anmelden (kostenlos), dann speichert ${K('Strg')}+${K('S')} in <b>Meine Noten</b>, zum Öffnen auf jedem Computer.</li>
     <li><b>Teilen</b>: eine Partitur <i>nicht gelistet</i> (nur mit dem Link) oder <i>öffentlich</i> (unter <a href="explore.html">Noten entdecken</a>) machen. Der Link öffnet eine Seite, auf der jeder sie sehen und hören kann.</li>
     <li><b>Dateien</b>: MusicXML (<code>.musicxml</code>, <code>.mxl</code>) öffnen und exportieren, um mit MuseScore, Flat, Finale, Sibelius und Dorico zu arbeiten. Außerdem MIDI-Export und eine Sicherung als <code>.pianissimo.json</code>.</li>`,
  ],
  'gp.guitar.1': [
    `Choisissez <b>Guitare + tab</b> dans <b>Instruments…</b> (ou appuyez sur ${K('Alt')}+${K('Maj')}+${K('B')} sur n’importe quelle portée) pour une tablature calculée à partir des notes en accord standard. ${K('Alt')}+${K('Maj')}+${K('D')} dessine les diagrammes d’accords au-dessus des symboles. Une partie <b>Batterie</b> a un élément par ligne ou interligne : grosse caisse, caisse claire, toms, charleston, ride et crash ; la barre d’état nomme les éléments sous le curseur.`,
    `Elige <b>Guitarra + tab</b> en <b>Instrumentos…</b> (o pulsa ${K('Alt')}+${K('Mayús')}+${K('B')} en cualquier pentagrama) para una tablatura calculada a partir de las notas en afinación estándar. ${K('Alt')}+${K('Mayús')}+${K('D')} dibuja los diagramas de acordes sobre los cifrados. Una parte de <b>Batería</b> tiene un elemento por línea o espacio: bombo, caja, toms, charles, ride y crash; la barra de estado nombra los elementos bajo el cursor.`,
    `Wählen Sie <b>Gitarre + Tab</b> unter <b>Instrumente…</b> (oder ${K('Alt')}+${K('Umschalt')}+${K('B')} auf einem beliebigen System) für eine Tabulatur, die aus den Noten in Standardstimmung berechnet wird. ${K('Alt')}+${K('Umschalt')}+${K('D')} zeichnet Griffbilder über die Akkordsymbole. Ein <b>Schlagzeug</b> hat ein Instrument pro Linie oder Zwischenraum: Bassdrum, Snare, Toms, Hi-Hat, Ride und Crash; die Statusleiste nennt die Instrumente unter dem Cursor.`,
  ],
  'gp.practice.1': [
    `Dans le panneau latéral, <b>Mixage et pratique</b> règle le volume de chaque partie avec muet et solo, la réverbération et le swing. <b>Tempo de travail</b> ralentit (ou accélère) la lecture sans changer le tempo écrit. Le <b>mode attente</b> (${K('Ctrl')}+${K('Alt')}+${K('W')}) s’arrête sur chaque accord de votre partie jusqu’à ce que vous le jouiez : au clavier MIDI, au clavier à l’écran ou en chantant dans le micro.`,
    `En el panel lateral, <b>Mezcla y práctica</b> ajusta el volumen de cada parte con silencio y solo, la reverberación y el swing. <b>Tempo de práctica</b> ralentiza (o acelera) la reproducción sin cambiar el tempo escrito. El <b>modo espera</b> (${K('Ctrl')}+${K('Alt')}+${K('W')}) se detiene en cada acorde de tu parte hasta que lo tocas: en un teclado MIDI, el teclado en pantalla o cantando al micrófono.`,
    `Im Seitenbereich stellt <b>Mischpult &amp; Üben</b> die Lautstärke jeder Stimme mit Stumm und Solo, den Hall und den Swing ein. <b>Übetempo</b> spielt langsamer (oder schneller), ohne das notierte Tempo zu ändern. Der <b>Wartemodus</b> (${K('Strg')}+${K('Alt')}+${K('W')}) hält bei jedem Akkord Ihrer Stimme, bis Sie ihn spielen: auf dem MIDI-Keyboard, der Bildschirmklaviatur oder singend ins Mikrofon.`,
  ],
  'gp.mic.1': [
    `${K('Ctrl')}+${K('Alt')}+${K('R')} (🎤) fait un décompte, puis écoute : chantez ou jouez une ligne et elle s’écrit en notes. ${K('Ctrl')}+${K('Alt')}+${K('U')} ouvre un accordeur qui montre la note, l’écart en cents, et passe au vert quand c’est juste. Le son reste dans votre navigateur.`,
    `${K('Ctrl')}+${K('Alt')}+${K('R')} (🎤) cuenta la entrada y escucha: canta o toca una línea y se escribe en notas. ${K('Ctrl')}+${K('Alt')}+${K('U')} abre un afinador que muestra la nota, la desviación en cents y se pone verde cuando estás afinado. El sonido no sale de tu navegador.`,
    `${K('Strg')}+${K('Alt')}+${K('R')} (🎤) zählt ein und hört dann zu: Eine Stimme singen oder spielen, und sie wird als Noten geschrieben. ${K('Strg')}+${K('Alt')}+${K('U')} öffnet ein Stimmgerät mit Ton, Abweichung in Cent und Grün, wenn es stimmt. Der Klang bleibt in Ihrem Browser.`,
  ],
  'gp.together.1': [
    `Dans <b>Partager</b>, invitez des personnes par l’adresse e-mail de leur compte : la partition apparaît dans leur bibliothèque. Quand vous l’avez tous ouverte, vous la modifiez en même temps et voyez les curseurs des autres ; ${K('Ctrl')}+${K('Z')} n’annule que vos propres modifications. Commentez une mesure avec 💬 (${K('Ctrl')}+${K('Alt')}+${K('M')}), et utilisez l’<b>historique des versions</b> pour revenir à un enregistrement antérieur.`,
    `En <b>Compartir</b>, invita a personas por el correo de su cuenta: la partitura aparece en su biblioteca. Cuando la tenéis abierta a la vez, la editáis juntos y veis los cursores de los demás; ${K('Ctrl')}+${K('Z')} solo deshace tus propios cambios. Comenta un compás con 💬 (${K('Ctrl')}+${K('Alt')}+${K('M')}) y usa el <b>historial de versiones</b> para volver a una versión anterior.`,
    `Unter <b>Teilen</b> laden Sie Personen über die E-Mail ihres Kontos ein: Die Partitur erscheint in ihrer Bibliothek. Ist sie bei allen offen, bearbeiten Sie gleichzeitig und sehen die Cursor der anderen; ${K('Strg')}+${K('Z')} nimmt nur Ihre eigenen Änderungen zurück. Mit 💬 (${K('Strg')}+${K('Alt')}+${K('M')}) kommentieren Sie einen Takt, und der <b>Versionsverlauf</b> holt frühere Stände zurück.`,
  ],
  'gp.classes.1': [
    `<b>📚 Classes</b> (${K('Ctrl')}+${K('Alt')}+${K('J')}) : un professeur crée une classe et partage son code ou son lien, puis donne en devoir la partition qu’il modifie, avec des consignes, une date de rendu et des critères de notation. Les élèves le commencent (ils reçoivent leur propre copie), le rendent, et voient le commentaire, la note et les appréciations au-dessus de leur partition. Les dates de rendu s’ajoutent à n’importe quel agenda.`,
    `<b>📚 Clases</b> (${K('Ctrl')}+${K('Alt')}+${K('J')}): un profesor crea una clase y comparte su código o enlace, y pone como tarea la partitura que está editando, con instrucciones, fecha de entrega y criterios de evaluación. Los alumnos la empiezan (reciben su propia copia), la entregan y ven los comentarios, la nota y las calificaciones encima de su partitura. Las fechas de entrega se pueden añadir a cualquier calendario.`,
    `<b>📚 Klassen</b> (${K('Strg')}+${K('Alt')}+${K('J')}): Eine Lehrkraft legt eine Klasse an, teilt Code oder Link und stellt die Partitur, die sie bearbeitet, als Aufgabe: mit Hinweisen, Abgabedatum und Bewertungskriterien. Schüler beginnen sie (mit eigener Kopie), geben ab und sehen Rückmeldung, Note und Bewertungen über ihrer Partitur. Die Abgabetermine lassen sich in jeden Kalender übernehmen.`,
  ],
  'gp.scan.1': [
    `<b>Importer ▾ → Numériser une page</b> (${K('Ctrl')}+${K('Alt')}+${K('O')}), ou déposez un PDF ou une image sur l’éditeur : la musique imprimée devient une partition à modifier, écouter et transposer. Dans l’application Windows, le lecteur de partitions (Audiveris, gratuit) s’installe avec Pianissimo, ou d’un clic dans cette fenêtre ; sur Mac ou Linux, la fenêtre montre comment l’installer ; sur un site web, le site doit avoir un lecteur de partitions. Utilisez un PDF, ou une photo droite et nette d’une page. La lecture prend environ une demi-minute par page ; les partitions manuscrites sont mal reconnues.`,
    `<b>Importar ▾ → Escanear una página</b> (${K('Ctrl')}+${K('Alt')}+${K('O')}), o suelta un PDF o una imagen en el editor: la música impresa se convierte en una partitura que puedes editar, reproducir y transportar. En la aplicación de Windows, el escáner (Audiveris, gratuito) se instala con Pianissimo, o con un clic en esta ventana; en Mac o Linux la ventana explica cómo instalarlo; en un sitio web, el sitio debe tener un escáner configurado. Usa un PDF o una foto recta y nítida de una página. La lectura tarda medio minuto por página; las partituras manuscritas no se reconocen bien.`,
    `<b>Importieren ▾ → Eine Seite scannen</b> (${K('Strg')}+${K('Alt')}+${K('O')}) oder ein PDF bzw. Bild auf den Editor ziehen: gedruckte Noten werden zu einer Partitur zum Bearbeiten, Abspielen und Transponieren. In der Windows-App wird der Scanner (Audiveris, kostenlos) mit Pianissimo installiert oder mit einem Klick in diesem Fenster; auf Mac oder Linux zeigt das Fenster, wie man ihn installiert; auf einer Website muss ein Scanner eingerichtet sein. Ein PDF oder ein gerades, scharfes Foto einer Seite verwenden. Das Lesen dauert etwa eine halbe Minute pro Seite; Handschrift wird schlecht erkannt.`,
  ],
  'gp.scan.2': [
    `La page s’affiche ensuite à côté de la partition, pour les comparer mesure par mesure et corriger ce qui a été mal lu. <b>📄 Page</b> (${K('Ctrl')}+${K('Alt')}+${K('P')}) la masque et l’affiche, <b>−</b> et <b>+</b> zooment, et son bord s’élargit en le faisant glisser. Enregistrée dans Mes partitions sur cet ordinateur, la page reste avec la partition. <b>Importer ▾ → Placer l’image d’une page à côté de la partition…</b> y affiche n’importe quelle image, pratique pour recopier une partition à la main.`,
    `La página aparece luego junto a la partitura, para compararlas compás a compás y corregir lo que se leyó mal. <b>📄 Página</b> (${K('Ctrl')}+${K('Alt')}+${K('P')}) la oculta y la muestra, <b>−</b> y <b>+</b> hacen zoom, y su borde se puede arrastrar para ensancharla. Guardada en Mis partituras en este equipo, la página se queda con la partitura. <b>Importar ▾ → Poner la imagen de una página junto a la partitura…</b> muestra ahí cualquier imagen, útil para copiar música a mano.`,
    `Danach erscheint die Seite neben der Partitur, so lassen sich beide Takt für Takt vergleichen und Lesefehler korrigieren. <b>📄 Seite</b> (${K('Strg')}+${K('Alt')}+${K('P')}) blendet sie aus und ein, <b>−</b> und <b>+</b> zoomen, und ihr Rand lässt sich breiter ziehen. In „Meine Noten“ auf diesem Computer gespeichert, bleibt die Seite bei der Partitur. <b>Importieren ▾ → Bild einer Seite neben die Partitur legen…</b> zeigt dort jedes Bild, praktisch beim Abschreiben von Noten.`,
  ],
  'gp.scan.3': [
    `<b>Importer ▾ → Transformer un enregistrement en notes</b> (${K('Ctrl')}+${K('Alt')}+${K('A')}) écoute un fichier WAV, MP3, M4A, OGG ou FLAC. <b>Une mélodie</b> (une voix, une flûte, un violon…) est suivie note par note ; <b>Des accords ou plusieurs notes à la fois</b> (piano, guitare) utilise Basic Pitch de Spotify et donne un brouillon à retoucher. Vérifiez le tempo, la mesure, le premier temps et la tonalité trouvés, puis cliquez sur <b>Écrire la partition</b>. Un tempo régulier et peu de bruit de fond aident le plus. L’enregistrement ne quitte jamais votre ordinateur.`,
    `<b>Importar ▾ → Convertir una grabación en notas</b> (${K('Ctrl')}+${K('Alt')}+${K('A')}) escucha un archivo WAV, MP3, M4A, OGG o FLAC. <b>Una melodía</b> (una voz, una flauta, un violín…) se sigue nota a nota; <b>Acordes o varias notas a la vez</b> (piano, guitarra) usa Basic Pitch de Spotify y da un borrador que hay que pulir. Revisa el tempo, el compás, el primer tiempo y la tonalidad que encontró y pulsa <b>Escribir la partitura</b>. Lo que más ayuda es un tempo constante y poco ruido de fondo. La grabación nunca sale de tu equipo.`,
    `<b>Importieren ▾ → Eine Aufnahme in Noten verwandeln</b> (${K('Strg')}+${K('Alt')}+${K('A')}) hört eine WAV-, MP3-, M4A-, OGG- oder FLAC-Datei an. <b>Eine Melodie</b> (eine Stimme, eine Flöte, eine Geige…) wird Ton für Ton verfolgt; <b>Akkorde oder mehrere Töne zugleich</b> (Klavier, Gitarre) nutzt Basic Pitch von Spotify und ergibt einen Entwurf zum Nachbessern. Tempo, Taktart, erste Zählzeit und Tonart prüfen, dann <b>Partitur schreiben</b> drücken. Am meisten helfen ein gleichmäßiges Tempo und wenig Hintergrundgeräusch. Die Aufnahme verlässt Ihren Computer nie.`,
  ],
  'gp.offline.1': [
    `Installez Pianissimo depuis le menu de votre navigateur (<i>Installer l’application</i> ou <i>Sur l’écran d’accueil</i>) : il s’ouvre comme une application et fonctionne sans connexion ; votre bibliothèque se synchronise au retour en ligne. Sur écran tactile, le clavier à l’écran (${K('Maj')}+${K('K')}) écrit les notes d’une touche.`,
    `Instala Pianissimo desde el menú del navegador (<i>Instalar aplicación</i> o <i>Añadir a pantalla de inicio</i>): se abre como una app y funciona sin conexión; tu biblioteca vuelve a guardar al recuperar la conexión. En pantallas táctiles, el teclado en pantalla (${K('Mayús')}+${K('K')}) escribe notas con un toque.`,
    `Installieren Sie Pianissimo über das Browsermenü (<i>App installieren</i> oder <i>Zum Home-Bildschirm</i>): Es startet wie eine App und läuft auch offline; Ihre Bibliothek speichert wieder, sobald Sie online sind. Auf Touchscreens schreibt die Bildschirmklaviatur (${K('Umschalt')}+${K('K')}) Noten mit einem Tippen.`,
  ],
};
