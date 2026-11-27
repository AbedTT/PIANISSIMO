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
  // updates of the desktop app (Phase 34)
  ['Pianissimo {version} is available.', 'Pianissimo {version} est disponible.', 'Pianissimo {version} está disponible.', 'Pianissimo {version} ist verfügbar.'],
  ['you have', 'vous avez', 'tienes', 'Sie haben'],
  ["What's new", 'Nouveautés', 'Novedades', 'Was ist neu'],
  ['Update now', 'Mettre à jour', 'Actualizar ahora', 'Jetzt aktualisieren'],
  ['Download', 'Télécharger', 'Descargar', 'Herunterladen'],
  ['Later', 'Plus tard', 'Más tarde', 'Später'],
  ['Downloading…', 'Téléchargement…', 'Descargando…', 'Wird heruntergeladen…'],
  ['No release notes.', 'Pas de notes de version.', 'Sin notas de la versión.', 'Keine Versionshinweise.'],
  ['Installing the update: Pianissimo closes and opens again in a moment. Your scores are kept.', 'Installation de la mise à jour : Pianissimo se ferme et se rouvre dans un instant. Vos partitions sont conservées.', 'Instalando la actualización: Pianissimo se cierra y se vuelve a abrir en un momento. Tus partituras se conservan.', 'Das Update wird installiert: Pianissimo schließt sich und öffnet sich gleich wieder. Ihre Partituren bleiben erhalten.'],
  // better scans: text reading, the page following the cursor (0.6.0)
  ['Titles and lyrics are not read yet: the scanner needs its text reading (a one-time download).', 'Les titres et paroles ne sont pas encore lus : le lecteur de partitions a besoin de sa lecture de texte (un téléchargement unique).', 'Los títulos y la letra aún no se leen: el escáner necesita su lectura de texto (una sola descarga).', 'Titel und Liedtexte werden noch nicht gelesen: der Scanner braucht seine Texterkennung (einmaliger Download).'],
  ['Add text reading', 'Ajouter la lecture de texte', 'Añadir la lectura de texto', 'Texterkennung hinzufügen'],
  ['Follow the cursor on the page', 'Suivre le curseur sur la page', 'Seguir el cursor en la página', 'Dem Cursor auf der Seite folgen'],
  ['The tempo changes (a live performance without a click)', 'Le tempo change (un enregistrement en direct, sans métronome)', 'El tempo cambia (una interpretación en vivo, sin metrónomo)', 'Das Tempo ändert sich (eine Live-Aufnahme ohne Klick)'],
  // updates and setting up the scanner (0.5.1)
  ['Checking for updates…', 'Recherche de mises à jour…', 'Buscando actualizaciones…', 'Suche nach Updates…'],
  ['✓ Pianissimo is up to date: you have the latest version ({version}).', '✓ Pianissimo est à jour : vous avez la dernière version ({version}).', '✓ Pianissimo está al día: tienes la última versión ({version}).', '✓ Pianissimo ist aktuell: Sie haben die neueste Version ({version}).'],
  ['Could not check for updates:', 'Impossible de rechercher les mises à jour :', 'No se pudo buscar actualizaciones:', 'Updates konnten nicht gesucht werden:'],
  ['This is the web version of Pianissimo: it updates itself whenever you reload the page', 'Ceci est la version web de Pianissimo : elle se met à jour chaque fois que vous rechargez la page', 'Esta es la versión web de Pianissimo: se actualiza sola cada vez que recargas la página', 'Dies ist die Web-Version von Pianissimo: sie aktualisiert sich bei jedem Neuladen der Seite'],
  ['No release has been published yet', 'Aucune version n’a encore été publiée', 'Aún no se ha publicado ninguna versión', 'Es wurde noch keine Version veröffentlicht'],
  ['Try again', 'Réessayer', 'Reintentar', 'Erneut versuchen'],
  ['OK', 'OK', 'Aceptar', 'OK'],
  ['⟳ Check for updates', '⟳ Rechercher des mises à jour', '⟳ Buscar actualizaciones', '⟳ Nach Updates suchen'],
  ['Scanning uses Audiveris, a free program that reads printed music. Pianissimo sets it up for you: one click, nothing else to install.', 'La numérisation utilise Audiveris, un logiciel gratuit qui lit les partitions imprimées. Pianissimo l’installe pour vous : un clic, rien d’autre à installer.', 'El escaneo usa Audiveris, un programa gratuito que lee partituras impresas. Pianissimo lo prepara por ti: un clic, nada más que instalar.', 'Das Scannen nutzt Audiveris, ein kostenloses Programm, das gedruckte Noten liest. Pianissimo richtet es für Sie ein: ein Klick, sonst nichts zu installieren.'],
  ['Set up the scanner', 'Installer le lecteur de partitions', 'Preparar el escáner', 'Scanner einrichten'],
  ['Or install Audiveris yourself', 'Ou installez Audiveris vous-même', 'O instala Audiveris tú mismo', 'Oder Audiveris selbst installieren'],
  ['It downloads about {mb} MB once, and is kept in Pianissimo’s folder (removing Pianissimo removes it too).', 'Il télécharge environ {mb} Mo une seule fois et reste dans le dossier de Pianissimo (le supprimer avec Pianissimo).', 'Descarga unos {mb} MB una sola vez y se guarda en la carpeta de Pianissimo (al quitar Pianissimo se quita también).', 'Es lädt einmalig etwa {mb} MB herunter und liegt im Ordner von Pianissimo (wird mit Pianissimo entfernt).'],
  ['Downloading the music scanner…', 'Téléchargement du lecteur de partitions…', 'Descargando el escáner de partituras…', 'Notenscanner wird heruntergeladen…'],
  ['Unpacking the music scanner…', 'Installation du lecteur de partitions…', 'Instalando el escáner de partituras…', 'Notenscanner wird entpackt…'],
  ['The music scanner is ready.', 'Le lecteur de partitions est prêt.', 'El escáner de partituras está listo.', 'Der Notenscanner ist bereit.'],
  ['The scanner could not be downloaded. Check your internet connection and try again.', 'Le lecteur de partitions n’a pas pu être téléchargé. Vérifiez votre connexion internet et réessayez.', 'No se pudo descargar el escáner. Comprueba tu conexión a internet e inténtalo de nuevo.', 'Der Scanner konnte nicht heruntergeladen werden. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.'],
  ['The scanner download was cut short. Check your internet connection and try again.', 'Le téléchargement a été interrompu. Vérifiez votre connexion internet et réessayez.', 'La descarga se interrumpió. Comprueba tu conexión a internet e inténtalo de nuevo.', 'Der Download wurde abgebrochen. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.'],
  ['The scanner download did not match its checksum, so it was not used.', 'Le fichier téléchargé ne correspond pas à sa somme de contrôle : il n’a pas été utilisé.', 'La descarga no coincidía con su suma de control, así que no se usó.', 'Der Download stimmte nicht mit seiner Prüfsumme überein und wurde daher nicht verwendet.'],
  ['Unpacking the scanner took too long.', 'L’installation du lecteur de partitions a pris trop de temps.', 'La instalación del escáner tardó demasiado.', 'Das Entpacken des Scanners hat zu lange gedauert.'],
  // importing: scanning pages, recordings to notes, the page beside the score (Phases 35–38)
  ['Import ▾', 'Importer ▾', 'Importar ▾', 'Importieren ▾'],
  ['📷 Scan a page (PDF or picture)…', '📷 Numériser une page (PDF ou image)…', '📷 Escanear una página (PDF o imagen)…', '📷 Eine Seite scannen (PDF oder Bild)…'],
  ['🎧 Turn a recording into notes…', '🎧 Transformer un enregistrement en notes…', '🎧 Convertir una grabación en notas…', '🎧 Eine Aufnahme in Noten verwandeln…'],
  ['MusicXML, MIDI or Pianissimo file…', 'Fichier MusicXML, MIDI ou Pianissimo…', 'Archivo MusicXML, MIDI o Pianissimo…', 'MusicXML-, MIDI- oder Pianissimo-Datei…'],
  ['🖼 Put a picture of a page beside the score…', '🖼 Placer l’image d’une page à côté de la partition…', '🖼 Poner la imagen de una página junto a la partitura…', '🖼 Bild einer Seite neben die Partitur legen…'],
  ['📄 Page', '📄 Page', '📄 Página', '📄 Seite'],
  ['Show or hide the printed page beside the score (Ctrl+Alt+P)', 'Afficher ou masquer la page imprimée à côté de la partition (Ctrl+Alt+P)', 'Mostrar u ocultar la página impresa junto a la partitura (Ctrl+Alt+P)', 'Die gedruckte Seite neben der Partitur ein- oder ausblenden (Strg+Alt+P)'],
  ['Scan a page', 'Numériser une page', 'Escanear una página', 'Seite scannen'],
  ['PDF or photo of printed music', 'PDF ou photo d’une partition imprimée', 'PDF o foto de una partitura impresa', 'PDF oder Foto gedruckter Noten'],
  ['From a recording', 'Depuis un enregistrement', 'Desde una grabación', 'Aus einer Aufnahme'],
  ['WAV or MP3 of a melody or chords', 'WAV ou MP3 d’une mélodie ou d’accords', 'WAV o MP3 de una melodía o de acordes', 'WAV oder MP3 einer Melodie oder von Akkorden'],
  ['Scan sheet music', 'Numériser une partition', 'Escanear una partitura', 'Noten scannen'],
  ['Turn a PDF, a scan or a photo of printed music into a score you can edit, play and transpose.', 'Transformez un PDF, un scan ou une photo d’une partition imprimée en partition à modifier, écouter et transposer.', 'Convierte un PDF, un escaneo o una foto de una partitura impresa en una partitura que puedes editar, reproducir y transportar.', 'Machen Sie aus einem PDF, Scan oder Foto gedruckter Noten eine Partitur zum Bearbeiten, Abspielen und Transponieren.'],
  ['Choose a PDF or picture…', 'Choisir un PDF ou une image…', 'Elegir un PDF o una imagen…', 'PDF oder Bild wählen…'],
  ['or drop it here', 'ou déposez-le ici', 'o suéltalo aquí', 'oder hier ablegen'],
  ['Printed music works best: a PDF, or a straight, sharp photo of one page in good light.', 'Les partitions imprimées marchent le mieux : un PDF, ou une photo droite et nette d’une page, bien éclairée.', 'Funciona mejor con partituras impresas: un PDF o una foto recta y nítida de una página, con buena luz.', 'Am besten gehen gedruckte Noten: ein PDF oder ein gerades, scharfes Foto einer Seite bei gutem Licht.'],
  ['Handwritten music is not recognised well.', 'Les partitions manuscrites sont mal reconnues.', 'Las partituras manuscritas no se reconocen bien.', 'Handgeschriebene Noten werden schlecht erkannt.'],
  ['Reading takes about half a minute per page. Then check the notes against the page, which is shown beside the score.', 'La lecture prend environ une demi-minute par page. Vérifiez ensuite les notes avec la page, affichée à côté de la partition.', 'La lectura tarda medio minuto por página. Luego comprueba las notas con la página, que se muestra junto a la partitura.', 'Das Lesen dauert etwa eine halbe Minute pro Seite. Prüfen Sie danach die Noten an der Seite, die neben der Partitur angezeigt wird.'],
  ['Reading the music…', 'Lecture de la musique…', 'Leyendo la música…', 'Noten werden gelesen…'],
  ['About half a minute per page. You can keep this window open; your current score is not changed until it is done.', 'Environ une demi-minute par page. Gardez cette fenêtre ouverte ; votre partition actuelle ne change pas avant la fin.', 'Unos treinta segundos por página. Deja esta ventana abierta; tu partitura actual no cambia hasta que termine.', 'Etwa eine halbe Minute pro Seite. Lassen Sie dieses Fenster offen; Ihre aktuelle Partitur ändert sich erst am Ende.'],
  ['Scanning uses Audiveris, a free program that reads printed music. Install it once on this computer:', 'La numérisation utilise Audiveris, un logiciel gratuit qui lit les partitions imprimées. Installez-le une fois sur cet ordinateur :', 'El escaneo usa Audiveris, un programa gratuito que lee partituras impresas. Instálalo una vez en este equipo:', 'Das Scannen nutzt Audiveris, ein kostenloses Programm, das gedruckte Noten liest. Installieren Sie es einmal auf diesem Computer:'],
  ['Open the Audiveris download page and download the file for your computer:', 'Ouvrez la page de téléchargement d’Audiveris et téléchargez le fichier pour votre ordinateur :', 'Abre la página de descarga de Audiveris y descarga el archivo para tu equipo:', 'Öffnen Sie die Download-Seite von Audiveris und laden Sie die Datei für Ihren Computer herunter:'],
  ['Open the downloaded file and follow the installer (it brings everything Audiveris needs).', 'Ouvrez le fichier téléchargé et suivez l’installation (elle apporte tout ce dont Audiveris a besoin).', 'Abre el archivo descargado y sigue el instalador (trae todo lo que Audiveris necesita).', 'Öffnen Sie die heruntergeladene Datei und folgen Sie dem Installer (er bringt alles mit, was Audiveris braucht).'],
  ['Come back here and press “Check again”.', 'Revenez ici et cliquez sur « Vérifier à nouveau ».', 'Vuelve aquí y pulsa «Comprobar de nuevo».', 'Kommen Sie hierher zurück und klicken Sie auf „Erneut prüfen“.'],
  ['Open the Audiveris download page', 'Ouvrir la page de téléchargement d’Audiveris', 'Abrir la página de descarga de Audiveris', 'Download-Seite von Audiveris öffnen'],
  ['Check again', 'Vérifier à nouveau', 'Comprobar de nuevo', 'Erneut prüfen'],
  ['Installed it somewhere else? Add a line audiveris= with the folder of Audiveris to Pianissimo’s settings.ini, then restart Pianissimo.', 'Installé ailleurs ? Ajoutez une ligne audiveris= avec le dossier d’Audiveris dans le settings.ini de Pianissimo, puis redémarrez Pianissimo.', '¿Lo instalaste en otro sitio? Añade una línea audiveris= con la carpeta de Audiveris al settings.ini de Pianissimo y reinicia Pianissimo.', 'Woanders installiert? Fügen Sie in Pianissimos settings.ini eine Zeile audiveris= mit dem Ordner von Audiveris hinzu und starten Sie Pianissimo neu.'],
  ['This website has no music scanner set up.', 'Ce site n’a pas de lecteur de partitions configuré.', 'Este sitio no tiene un escáner de partituras configurado.', 'Auf dieser Website ist kein Notenscanner eingerichtet.'],
  ['Scanning works in the Pianissimo desktop app once the free program Audiveris is installed next to it, or on a Pianissimo website whose operator set up Audiveris on the server.', 'La numérisation fonctionne dans l’application de bureau Pianissimo une fois le logiciel gratuit Audiveris installé, ou sur un site Pianissimo dont l’exploitant a installé Audiveris sur le serveur.', 'El escaneo funciona en la aplicación de escritorio de Pianissimo con el programa gratuito Audiveris instalado, o en un sitio de Pianissimo cuyo responsable instaló Audiveris en el servidor.', 'Scannen funktioniert in der Pianissimo-Desktop-App, sobald das kostenlose Programm Audiveris installiert ist, oder auf einer Pianissimo-Website, deren Betreiber Audiveris auf dem Server eingerichtet hat.'],
  ['the .dmg file (arm64 for Apple silicon, x86_64 for Intel Macs)', 'le fichier .dmg (arm64 pour Apple silicon, x86_64 pour les Mac Intel)', 'el archivo .dmg (arm64 para Apple silicon, x86_64 para Mac con Intel)', 'die .dmg-Datei (arm64 für Apple Silicon, x86_64 für Intel-Macs)'],
  ['the .deb file for Ubuntu or Debian (or install Audiveris from Flathub)', 'le fichier .deb pour Ubuntu ou Debian (ou installez Audiveris depuis Flathub)', 'el archivo .deb para Ubuntu o Debian (o instala Audiveris desde Flathub)', 'die .deb-Datei für Ubuntu oder Debian (oder Audiveris über Flathub installieren)'],
  ['the .msi file whose name ends in windows-x86_64.msi', 'le fichier .msi dont le nom finit par windows-x86_64.msi', 'el archivo .msi cuyo nombre termina en windows-x86_64.msi', 'die .msi-Datei, deren Name auf windows-x86_64.msi endet'],
  ['The printed page', 'La page imprimée', 'La página impresa', 'Die gedruckte Seite'],
  ['Previous page', 'Page précédente', 'Página anterior', 'Vorige Seite'],
  ['Next page', 'Page suivante', 'Página siguiente', 'Nächste Seite'],
  ['Zoom out', 'Dézoomer', 'Alejar', 'Verkleinern'],
  ['Zoom in', 'Zoomer', 'Acercar', 'Vergrößern'],
  ['Hide the page', 'Masquer la page', 'Ocultar la página', 'Seite ausblenden'],
  ['Drag to resize', 'Faire glisser pour redimensionner', 'Arrastra para cambiar el tamaño', 'Zum Ändern der Größe ziehen'],
  ['Page', 'Page', 'Página', 'Seite'],
  ['Turn a recording into notes', 'Transformer un enregistrement en notes', 'Convertir una grabación en notas', 'Eine Aufnahme in Noten verwandeln'],
  ['What is in the recording?', 'Que contient l’enregistrement ?', '¿Qué hay en la grabación?', 'Was ist in der Aufnahme?'],
  ['One melody', 'Une mélodie', 'Una melodía', 'Eine Melodie'],
  ['A voice, a flute, a violin, a whistle… one note at a time.', 'Une voix, une flûte, un violon, un sifflement… une note à la fois.', 'Una voz, una flauta, un violín, un silbido… una nota cada vez.', 'Eine Stimme, eine Flöte, eine Geige, ein Pfeifen… ein Ton nach dem anderen.'],
  ['Chords or several notes at once', 'Des accords ou plusieurs notes à la fois', 'Acordes o varias notas a la vez', 'Akkorde oder mehrere Töne zugleich'],
  ['Piano or guitar. Takes longer, and gives a draft to tidy up.', 'Piano ou guitare. Plus long, et donne un brouillon à retoucher.', 'Piano o guitarra. Tarda más y da un borrador que hay que pulir.', 'Klavier oder Gitarre. Dauert länger und ergibt einen Entwurf zum Nachbessern.'],
  ['Choose a recording…', 'Choisir un enregistrement…', 'Elegir una grabación…', 'Aufnahme wählen…'],
  ['WAV, MP3, M4A, OGG or FLAC, or drop it here', 'WAV, MP3, M4A, OGG ou FLAC, ou déposez-le ici', 'WAV, MP3, M4A, OGG o FLAC, o suéltalo aquí', 'WAV, MP3, M4A, OGG oder FLAC, oder hier ablegen'],
  ['Best results: one instrument or voice, little background noise and echo, a steady tempo.', 'Meilleurs résultats : un seul instrument ou une voix, peu de bruit de fond et d’écho, un tempo régulier.', 'Mejores resultados: un instrumento o una voz, poco ruido de fondo y eco, un tempo constante.', 'Beste Ergebnisse: ein Instrument oder eine Stimme, wenig Hintergrundgeräusch und Hall, ein gleichmäßiges Tempo.'],
  ['The recording stays on this computer: it is not uploaded.', 'L’enregistrement reste sur cet ordinateur : il n’est pas envoyé.', 'La grabación se queda en este equipo: no se sube.', 'Die Aufnahme bleibt auf diesem Computer: sie wird nicht hochgeladen.'],
  ['Listening…', 'Écoute…', 'Escuchando…', 'Hört zu…'],
  ['First note on beat', 'Première note sur le temps', 'Primera nota en el tiempo', 'Erster Ton auf Zählzeit'],
  ['If the notes come out twice too long or too short, halve or double the tempo.', 'Si les notes sont deux fois trop longues ou trop courtes, divisez ou doublez le tempo.', 'Si las notas salen el doble de largas o de cortas, reduce a la mitad o duplica el tempo.', 'Wenn die Noten doppelt so lang oder kurz herauskommen, das Tempo halbieren oder verdoppeln.'],
  ['← Another recording', '← Un autre enregistrement', '← Otra grabación', '← Andere Aufnahme'],
  ['Write the score', 'Écrire la partition', 'Escribir la partitura', 'Partitur schreiben'],
  ['Choose an audio file: WAV, MP3, M4A, OGG or FLAC.', 'Choisissez un fichier audio : WAV, MP3, M4A, OGG ou FLAC.', 'Elige un archivo de audio: WAV, MP3, M4A, OGG o FLAC.', 'Wählen Sie eine Audiodatei: WAV, MP3, M4A, OGG oder FLAC.'],
  ['Reading the recording…', 'Lecture de l’enregistrement…', 'Leyendo la grabación…', 'Aufnahme wird gelesen…'],
  ['Loading the chord listener…', 'Chargement de l’écoute des accords…', 'Cargando el reconocimiento de acordes…', 'Akkorderkennung wird geladen…'],
  ['Listening for chords…', 'Écoute des accords…', 'Escuchando los acordes…', 'Hört auf Akkorde…'],
  ['Recording', 'Enregistrement', 'Grabación', 'Aufnahme'],
  ['Voice', 'Voix', 'Voz', 'Stimme'],
  ['(only the first 15 minutes)', '(seulement les 15 premières minutes)', '(solo los primeros 15 minutos)', '(nur die ersten 15 Minuten)'],
  ['Notes heard:', 'Notes entendues :', 'Notas oídas:', 'Gehörte Töne:'],
  ['This audio file could not be read. Try a WAV or MP3 file.', 'Ce fichier audio n’a pas pu être lu. Essayez un fichier WAV ou MP3.', 'No se pudo leer este archivo de audio. Prueba con un WAV o MP3.', 'Diese Audiodatei konnte nicht gelesen werden. Versuchen Sie eine WAV- oder MP3-Datei.'],
  ['The chord listener could not be loaded. Check your connection and try again.', 'L’écoute des accords n’a pas pu être chargée. Vérifiez votre connexion et réessayez.', 'No se pudo cargar el reconocimiento de acordes. Comprueba tu conexión e inténtalo de nuevo.', 'Die Akkorderkennung konnte nicht geladen werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.'],
  ['No notes were heard in this recording.', 'Aucune note n’a été entendue dans cet enregistrement.', 'No se oyó ninguna nota en esta grabación.', 'In dieser Aufnahme wurden keine Töne gehört.'],
  ['Scan a PDF, PNG, JPEG or TIFF file.', 'Numérisez un fichier PDF, PNG, JPEG ou TIFF.', 'Escanea un archivo PDF, PNG, JPEG o TIFF.', 'Scannen Sie eine PDF-, PNG-, JPEG- oder TIFF-Datei.'],
  ['Scan a PNG, JPEG, TIFF or PDF file.', 'Numérisez un fichier PNG, JPEG, TIFF ou PDF.', 'Escanea un archivo PNG, JPEG, TIFF o PDF.', 'Scannen Sie eine PNG-, JPEG-, TIFF- oder PDF-Datei.'],
  ['Audiveris is not installed on this computer.', 'Audiveris n’est pas installé sur cet ordinateur.', 'Audiveris no está instalado en este equipo.', 'Audiveris ist auf diesem Computer nicht installiert.'],
  ['That file is too large to scan (30 MB at most).', 'Ce fichier est trop gros pour être numérisé (30 Mo au plus).', 'Ese archivo es demasiado grande para escanearlo (30 MB como máximo).', 'Diese Datei ist zu groß zum Scannen (höchstens 30 MB).'],
  ['That file is too large to scan (10 MB at most).', 'Ce fichier est trop gros pour être numérisé (10 Mo au plus).', 'Ese archivo es demasiado grande para escanearlo (10 MB como máximo).', 'Diese Datei ist zu groß zum Scannen (höchstens 10 MB).'],
  ['No music could be recognised on that page. Try a straighter, sharper scan or photo.', 'Aucune musique n’a été reconnue sur cette page. Essayez un scan ou une photo plus droit et plus net.', 'No se reconoció música en esa página. Prueba con un escaneo o una foto más recta y nítida.', 'Auf dieser Seite wurden keine Noten erkannt. Versuchen Sie einen geraderen, schärferen Scan oder ein solches Foto.'],
  ['No music could be recognised on that page. Try a straighter, sharper photo.', 'Aucune musique n’a été reconnue sur cette page. Essayez une photo plus droite et plus nette.', 'No se reconoció música en esa página. Prueba con una foto más recta y nítida.', 'Auf dieser Seite wurden keine Noten erkannt. Versuchen Sie ein geraderes, schärferes Foto.'],
  ['Reading the music took too long. Try one page at a time.', 'La lecture a pris trop de temps. Essayez une page à la fois.', 'La lectura tardó demasiado. Prueba con una página cada vez.', 'Das Lesen hat zu lange gedauert. Versuchen Sie eine Seite nach der anderen.'],
  ['Scanning took too long. Try a single page.', 'La numérisation a pris trop de temps. Essayez une seule page.', 'El escaneo tardó demasiado. Prueba con una sola página.', 'Das Scannen hat zu lange gedauert. Versuchen Sie eine einzelne Seite.'],
  ['Choose a photo or PDF of the sheet music.', 'Choisissez une photo ou un PDF de la partition.', 'Elige una foto o un PDF de la partitura.', 'Wählen Sie ein Foto oder PDF der Noten.'],
  ['That is a lot of scanning: please wait a while.', 'Cela fait beaucoup de numérisations : patientez un peu.', 'Son muchos escaneos: espera un rato.', 'Das sind viele Scans: bitte warten Sie eine Weile.'],
  ['Sign in to scan sheet music (the server reads the page).', 'Connectez-vous pour numériser une partition (le serveur lit la page).', 'Inicia sesión para escanear partituras (el servidor lee la página).', 'Melden Sie sich an, um Noten zu scannen (der Server liest die Seite).'],
  // the library on this computer (Phase 34)
  ['Saved on this computer', 'Enregistré sur cet ordinateur', 'Guardado en este equipo', 'Auf diesem Computer gespeichert'],
  ['On this computer', 'Sur cet ordinateur', 'En este equipo', 'Auf diesem Computer'],
  ['Online library', 'Bibliothèque en ligne', 'Biblioteca en línea', 'Online-Bibliothek'],
  ['Save current score here', 'Enregistrer la partition ouverte ici', 'Guardar aquí la partitura abierta', 'Aktuelle Partitur hier speichern'],
  ['Back up all…', 'Tout sauvegarder…', 'Copia de todo…', 'Alles sichern…'],
  ['Restore…', 'Restaurer…', 'Restaurar…', 'Wiederherstellen…'],
  ['All the scores on this computer, as one file', 'Toutes les partitions de cet ordinateur, en un seul fichier', 'Todas las partituras de este equipo, en un solo archivo', 'Alle Partituren auf diesem Computer in einer Datei'],
  ['Add the scores from a backup file', 'Ajouter les partitions d’un fichier de sauvegarde', 'Añadir las partituras de un archivo de copia', 'Partituren aus einer Sicherungsdatei hinzufügen'],
  ['Sign in to keep scores online too and open them on any device.', 'Connectez-vous pour garder aussi vos partitions en ligne et les ouvrir sur tout appareil.', 'Inicia sesión para guardar también tus partituras en línea y abrirlas en cualquier dispositivo.', 'Melden Sie sich an, um Partituren auch online zu speichern und auf jedem Gerät zu öffnen.'],
  ['Nothing here yet. Press Ctrl+S in the editor to save the score you are writing; it then keeps itself saved.', 'Rien pour l’instant. Appuyez sur Ctrl+S dans l’éditeur pour enregistrer la partition en cours ; elle s’enregistre ensuite toute seule.', 'Aún no hay nada. Pulsa Ctrl+S en el editor para guardar la partitura que escribes; después se guarda sola.', 'Noch nichts hier. Drücken Sie Strg+S im Editor, um die aktuelle Partitur zu speichern; danach speichert sie sich selbst.'],
  ['Duplicate', 'Dupliquer', 'Duplicar', 'Duplizieren'],
  ['Delete', 'Supprimer', 'Eliminar', 'Löschen'],
  ['Copy online', 'Copier en ligne', 'Copiar en línea', 'Online kopieren'],
  ['Copy it to your online library', 'La copier dans votre bibliothèque en ligne', 'Copiarla a tu biblioteca en línea', 'In Ihre Online-Bibliothek kopieren'],
  ['Delete this score from this computer? This cannot be undone.', 'Supprimer cette partition de cet ordinateur ? C’est définitif.', '¿Eliminar esta partitura de este equipo? No se puede deshacer.', 'Diese Partitur von diesem Computer löschen? Das kann nicht rückgängig gemacht werden.'],
  // account dialog (Phase 32)
  ['Create account', 'Créer un compte', 'Crear cuenta', 'Konto erstellen'],
  ['Create your free account', 'Créez votre compte gratuit', 'Crea tu cuenta gratuita', 'Kostenloses Konto erstellen'],
  ['Your name', 'Votre nom', 'Tu nombre', 'Ihr Name'],
  ['Password', 'Mot de passe', 'Contraseña', 'Passwort'],
  ['New password', 'Nouveau mot de passe', 'Nueva contraseña', 'Neues Passwort'],
  ['Current password', 'Mot de passe actuel', 'Contraseña actual', 'Aktuelles Passwort'],
  ['Forgot your password?', 'Mot de passe oublié ?', '¿Olvidaste tu contraseña?', 'Passwort vergessen?'],
  ['← Back to sign in', '← Retour à la connexion', '← Volver a iniciar sesión', '← Zurück zur Anmeldung'],
  ['Send the link', 'Envoyer le lien', 'Enviar el enlace', 'Link senden'],
  ['Type the email of your account. We send you a link to choose a new password.', 'Saisissez l’e-mail de votre compte. Nous vous envoyons un lien pour choisir un nouveau mot de passe.', 'Escribe el correo de tu cuenta. Te enviamos un enlace para elegir una nueva contraseña.', 'Geben Sie die E-Mail Ihres Kontos ein. Wir senden Ihnen einen Link für ein neues Passwort.'],
  ['If an account uses that email, a link to choose a new password is on its way. It works for one hour.', 'Si un compte utilise cet e-mail, un lien pour choisir un nouveau mot de passe est en route. Il fonctionne une heure.', 'Si una cuenta usa ese correo, va de camino un enlace para elegir una nueva contraseña. Funciona durante una hora.', 'Wenn ein Konto diese E-Mail nutzt, ist ein Link für ein neues Passwort unterwegs. Er gilt eine Stunde.'],
  ['Choose a new password', 'Choisissez un nouveau mot de passe', 'Elige una nueva contraseña', 'Neues Passwort festlegen'],
  ['Save the new password', 'Enregistrer le nouveau mot de passe', 'Guardar la nueva contraseña', 'Neues Passwort speichern'],
  ['At least 8 characters. Your other devices are signed out.', 'Au moins 8 caractères. Vos autres appareils sont déconnectés.', 'Al menos 8 caracteres. Se cierra la sesión en tus otros dispositivos.', 'Mindestens 8 Zeichen. Ihre anderen Geräte werden abgemeldet.'],
  ['Change your password', 'Changer votre mot de passe', 'Cambiar tu contraseña', 'Passwort ändern'],
  ['Change password', 'Changer le mot de passe', 'Cambiar contraseña', 'Passwort ändern'],
  ['Change password…', 'Changer le mot de passe…', 'Cambiar contraseña…', 'Passwort ändern…'],
  ['✉ Confirm my email', '✉ Confirmer mon e-mail', '✉ Confirmar mi correo', '✉ Meine E-Mail bestätigen'],
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
  ['Chord note', 'Note de l’accord', 'Nota del acorde', 'Akkordnote'],
  ['Esc: whole chord', 'Échap : tout l’accord', 'Esc: todo el acorde', 'Esc: ganzer Akkord'],
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
