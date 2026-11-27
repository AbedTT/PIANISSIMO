/**
 * About, Privacy and Terms (about.html, privacy.html, terms.html), by `data-i18n` key:
 * [French, Spanish, German] HTML. Legal text: translated for convenience, the English page is
 * the reference, and a site operator should have it reviewed (the pages say so).
 */
export const LEGAL_BLOCKS: Record<string, [string, string, string]> = {
  // ---------------------------------------------------------------- about
  'ab.title': ['À propos de Pianissimo', 'Acerca de Pianissimo', 'Über Pianissimo'],
  'ab.lead': [
    'Écrire une partition devrait être aussi simple qu’écrire un message.',
    'Escribir partituras debería ser tan fácil como escribir un mensaje.',
    'Noten schreiben sollte so einfach sein wie eine Nachricht tippen.',
  ],
  'ab.toc.why': ['Pourquoi', 'Por qué', 'Warum'],
  'ab.toc.how': ['Fonctionnement', 'Cómo funciona', 'So funktioniert es'],
  'ab.toc.privacy': ['Vos données', 'Tus datos', 'Ihre Daten'],
  'ab.toc.credits': ['Crédits', 'Créditos', 'Danksagungen'],
  'ab.h.why': ['Pourquoi Pianissimo', 'Por qué Pianissimo', 'Warum Pianissimo'],
  'ab.1': [
    'La plupart des logiciels de notation vous font chercher dans des palettes et des menus. Pianissimo est conçu autour du clavier : chaque action est une commande courte, alors écrire une mélodie ressemble à taper une phrase, et vous l’entendez au fur et à mesure.',
    'La mayoría de los programas de notación te hacen buscar en paletas y menús. Pianissimo está pensado para el teclado: cada acción es un comando corto, así que escribir una melodía se parece a escribir una frase, y la oyes mientras escribes.',
    'Die meisten Notenprogramme lassen Sie in Paletten und Menüs suchen. Pianissimo ist für die Tastatur gebaut: Jede Aktion ist ein kurzer Befehl, so fühlt sich eine Melodie schreiben wie einen Satz tippen an, und Sie hören sie dabei.',
  ],
  'ab.2': [
    'Il s’adresse aux élèves qui écrivent leurs premiers exercices, aux professeurs qui préparent des fiches, aux auteurs-compositeurs qui esquissent des grilles et aux chœurs qui impriment leurs parties.',
    'Es para estudiantes que escriben sus primeros ejercicios, profesores que preparan fichas, compositores que esbozan lead sheets y coros que imprimen sus partes.',
    'Es ist für Schüler, die ihre ersten Übungen schreiben, Lehrkräfte, die Arbeitsblätter vorbereiten, Songwriter, die Leadsheets skizzieren, und Chöre, die ihre Stimmen drucken.',
  ],
  'ab.h.how': ['Fonctionnement', 'Cómo funciona', 'So funktioniert es'],
  'ab.3': [
    `<li>Tout fonctionne dans votre navigateur, rien à installer. Une fois l’éditeur ouvert, vous pouvez continuer sans connexion ; les sons d’instruments se téléchargent la première fois.</li>
     <li>Les partitions utilisent un format ouvert et s’exportent en MusicXML, le standard que lisent tous les grands logiciels de notation : votre musique n’est jamais enfermée.</li>
     <li>La connexion est facultative. Elle ajoute une bibliothèque en ligne, le partage par lien, l’édition à plusieurs et les classes.</li>`,
    `<li>Todo funciona en tu navegador, no hay nada que instalar. Con el editor abierto puedes seguir sin conexión; los sonidos de instrumentos se descargan la primera vez.</li>
     <li>Las partituras usan un formato abierto y se exportan a MusicXML, el estándar que leen todos los grandes programas de notación, así tu música nunca queda atrapada.</li>
     <li>Iniciar sesión es opcional. Añade una biblioteca en la nube, enlaces para compartir, edición en grupo y clases.</li>`,
    `<li>Alles läuft im Browser, nichts zu installieren. Ist der Editor offen, können Sie auch ohne Verbindung weiterschreiben; Instrumentenklänge werden beim ersten Gebrauch geladen.</li>
     <li>Partituren nutzen ein offenes Format und lassen sich als MusicXML exportieren, den Standard, den alle großen Notenprogramme lesen: Ihre Musik ist nie eingesperrt.</li>
     <li>Anmelden ist freiwillig. Es bringt eine Online-Bibliothek, Links zum Teilen, gemeinsames Bearbeiten und Klassen.</li>`,
  ],
  'ab.h.privacy': ['Vos données', 'Tus datos', 'Ihre Daten'],
  'ab.4': [
    'Les partitions restent privées sauf si vous choisissez de les partager. Nous ne gardons que ce qui est nécessaire au fonctionnement de votre compte. Voir la <a href="privacy.html">politique de confidentialité</a>.',
    'Las partituras son privadas salvo que decidas compartirlas. Solo guardamos lo necesario para que funcione tu cuenta. Consulta la <a href="privacy.html">política de privacidad</a>.',
    'Partituren bleiben privat, außer Sie teilen sie. Wir speichern nur, was Ihr Konto braucht. Siehe die <a href="privacy.html">Datenschutzerklärung</a>.',
  ],
  'ab.h.credits': ['Crédits', 'Créditos', 'Danksagungen'],
  'ab.5': [
    'Pianissimo s’appuie sur d’excellents projets libres :',
    'Pianissimo se apoya en excelentes proyectos de código abierto:',
    'Pianissimo baut auf hervorragender Open-Source-Arbeit auf:',
  ],
  'ab.credits.table': [
    `<tr><th>Projet</th><th>Utilisé pour</th><th>Licence</th></tr>
     <tr><td><a href="https://www.vexflow.com/" rel="noopener">VexFlow</a></td><td>Gravure musicale</td><td>MIT</td></tr>
     <tr><td><a href="https://github.com/steinbergmedia/bravura" rel="noopener">Bravura</a> (Steinberg)</td><td>Police musicale (SMuFL)</td><td>SIL Open Font License</td></tr>
     <tr><td><a href="https://tonejs.github.io/" rel="noopener">Tone.js</a></td><td>Lecture audio</td><td>MIT</td></tr>
     <tr><td>Salamander Grand Piano (Alexander Holm)</td><td>Son de piano de concert</td><td>CC BY 3.0</td></tr>
     <tr><td>FluidR3 GM soundfont (Frank Wen), via <a href="https://github.com/gleitz/midi-js-soundfonts" rel="noopener">midi-js-soundfonts</a></td><td>Sons d’instruments</td><td>MIT</td></tr>`,
    `<tr><th>Proyecto</th><th>Uso</th><th>Licencia</th></tr>
     <tr><td><a href="https://www.vexflow.com/" rel="noopener">VexFlow</a></td><td>Grabado musical</td><td>MIT</td></tr>
     <tr><td><a href="https://github.com/steinbergmedia/bravura" rel="noopener">Bravura</a> (Steinberg)</td><td>Fuente musical (SMuFL)</td><td>SIL Open Font License</td></tr>
     <tr><td><a href="https://tonejs.github.io/" rel="noopener">Tone.js</a></td><td>Reproducción de audio</td><td>MIT</td></tr>
     <tr><td>Salamander Grand Piano (Alexander Holm)</td><td>Sonido de piano de cola</td><td>CC BY 3.0</td></tr>
     <tr><td>FluidR3 GM soundfont (Frank Wen), vía <a href="https://github.com/gleitz/midi-js-soundfonts" rel="noopener">midi-js-soundfonts</a></td><td>Sonidos de instrumentos</td><td>MIT</td></tr>`,
    `<tr><th>Projekt</th><th>Verwendet für</th><th>Lizenz</th></tr>
     <tr><td><a href="https://www.vexflow.com/" rel="noopener">VexFlow</a></td><td>Notensatz</td><td>MIT</td></tr>
     <tr><td><a href="https://github.com/steinbergmedia/bravura" rel="noopener">Bravura</a> (Steinberg)</td><td>Notenschrift (SMuFL)</td><td>SIL Open Font License</td></tr>
     <tr><td><a href="https://tonejs.github.io/" rel="noopener">Tone.js</a></td><td>Audiowiedergabe</td><td>MIT</td></tr>
     <tr><td>Salamander Grand Piano (Alexander Holm)</td><td>Konzertflügel-Klang</td><td>CC BY 3.0</td></tr>
     <tr><td>FluidR3 GM soundfont (Frank Wen), über <a href="https://github.com/gleitz/midi-js-soundfonts" rel="noopener">midi-js-soundfonts</a></td><td>Instrumentenklänge</td><td>MIT</td></tr>`,
  ],

  // ---------------------------------------------------------------- privacy
  'pv.title': ['Politique de confidentialité', 'Política de privacidad', 'Datenschutzerklärung'],
  'pv.lead': [
    'Ce que Pianissimo conserve et pourquoi, en langage simple.',
    'Qué guarda Pianissimo y por qué, en lenguaje sencillo.',
    'Was Pianissimo speichert und warum, in einfacher Sprache.',
  ],
  'pv.h.local': ['Sans compte', 'Sin cuenta', 'Ohne Konto'],
  'pv.local': [
    'L’éditeur fonctionne entièrement dans votre navigateur. La partition en cours, votre langue, votre thème et votre tempo de travail sont gardés dans le stockage local de votre navigateur, sur votre appareil, et l’application elle-même est mise en cache pour s’ouvrir hors ligne. Rien de cela ne nous est envoyé.',
    'El editor funciona por completo en tu navegador. La partitura en la que trabajas, tu idioma, tema y tempo de práctica se guardan en el almacenamiento local del navegador, en tu dispositivo, y la aplicación se guarda en caché para abrirse sin conexión. Nada de esto se nos envía.',
    'Der Editor läuft vollständig in Ihrem Browser. Die aktuelle Partitur, Ihre Sprache, Ihr Design und Ihr Übetempo liegen im lokalen Speicher Ihres Browsers auf Ihrem Gerät, und die App selbst wird zwischengespeichert, damit sie offline startet. Nichts davon wird an uns gesendet.',
  ],
  'pv.sounds': [
    'Les sons d’instruments sont téléchargés depuis des bibliothèques publiques d’échantillons la première fois que vous les utilisez (GitHub Pages héberge les fichiers du piano Salamander et de la soundfont FluidR3). Comme tout site web, ces hébergeurs voient votre adresse IP quand votre navigateur demande les fichiers.',
    'Los sonidos de instrumentos se descargan de bibliotecas públicas de muestras la primera vez que los usas (GitHub Pages aloja los archivos del piano Salamander y de la soundfont FluidR3). Como cualquier sitio web, esos servidores ven tu dirección IP cuando tu navegador pide los archivos.',
    'Instrumentenklänge werden beim ersten Gebrauch aus öffentlichen Sample-Bibliotheken geladen (GitHub Pages stellt die Dateien des Salamander-Flügels und der FluidR3-Soundfont bereit). Wie jede Website sehen diese Server Ihre IP-Adresse, wenn Ihr Browser die Dateien abruft.',
  ],
  'pv.mic': [
    'Si vous utilisez le micro (accordeur, enregistrement en chantant ou en jouant, mode attente), le son est analysé dans votre navigateur pour trouver les notes. L’audio n’est jamais envoyé ni enregistré ; seules les notes obtenues entrent dans votre partition.',
    'Si usas el micrófono (afinador, grabar cantando o tocando, modo espera), el sonido se analiza en tu navegador para encontrar las notas. El audio nunca se sube ni se guarda; solo las notas resultantes pasan a tu partitura.',
    'Wenn Sie das Mikrofon nutzen (Stimmgerät, Aufnahme durch Singen oder Spielen, Wartemodus), wird der Klang in Ihrem Browser ausgewertet, um die Noten zu finden. Audio wird nie hochgeladen oder gespeichert; nur die erkannten Noten kommen in Ihre Partitur.',
  ],
  'pv.h.account': ['Avec un compte', 'Con una cuenta', 'Mit einem Konto'],
  'pv.account.lead': ['Si vous créez un compte, nous conservons :', 'Si creas una cuenta, guardamos:', 'Wenn Sie ein Konto anlegen, speichern wir:'],
  'pv.account': [
    `<li>votre nom et votre adresse e-mail, pour vous identifier et vous connecter ;</li>
     <li>votre mot de passe, uniquement sous forme d’empreinte à sens unique (nous ne pouvons jamais le lire) ;</li>
     <li>les partitions enregistrées dans votre bibliothèque, avec leur titre, leur réglage de partage et jusqu’à 50 versions antérieures ;</li>
     <li>vos réglages de notifications et vos notifications récentes (les 200 dernières) ;</li>
     <li>un court relevé des tentatives de connexion par adresse IP, pour freiner les essais de mots de passe (gardé environ une heure).</li>`,
    `<li>tu nombre y tu correo electrónico, para identificarte y que puedas iniciar sesión;</li>
     <li>tu contraseña, solo como un hash de un solo sentido (nunca podemos leerla);</li>
     <li>las partituras que guardas en tu biblioteca, con su título, su ajuste de uso compartido y hasta 50 versiones anteriores;</li>
     <li>tus ajustes de notificaciones y tus notificaciones recientes (las últimas 200);</li>
     <li>un breve registro de intentos de inicio de sesión por dirección IP, para frenar intentos de adivinar contraseñas (se guarda una hora aproximadamente).</li>`,
    `<li>Ihren Namen und Ihre E-Mail-Adresse, um Sie zu erkennen und anzumelden;</li>
     <li>Ihr Passwort, nur als Einweg-Hash (wir können es nie lesen);</li>
     <li>die Partituren in Ihrer Bibliothek, mit Titel, Freigabe-Einstellung und bis zu 50 früheren Versionen;</li>
     <li>Ihre Benachrichtigungs-Einstellungen und Ihre letzten Benachrichtigungen (die letzten 200);</li>
     <li>eine kurze Liste der Anmeldeversuche je IP-Adresse, um das Erraten von Passwörtern zu bremsen (etwa eine Stunde lang gespeichert).</li>`,
  ],
  'pv.h.together': ['Éditer à plusieurs', 'Editar en grupo', 'Gemeinsam bearbeiten'],
  'pv.together': [
    'Les personnes que vous invitez sur une partition peuvent l’ouvrir et la modifier, et voient votre nom. Pendant l’édition en direct, votre nom et la position de votre curseur sont transmis aux autres par le service d’édition en direct du site ; ils n’y sont pas conservés.',
    'Las personas que invitas a una partitura pueden abrirla y editarla, y ven tu nombre. Mientras editáis en directo, tu nombre y la posición de tu cursor llegan a los demás a través del servicio de edición en directo del sitio; allí no se guardan.',
    'Personen, die Sie zu einer Partitur einladen, können sie öffnen und bearbeiten und sehen Ihren Namen. Beim gemeinsamen Live-Bearbeiten werden Ihr Name und die Position Ihres Cursors über den Live-Dienst der Website an die anderen weitergegeben; dort werden sie nicht gespeichert.',
  ],
  'pv.h.classes': ['Classes', 'Clases', 'Klassen'],
  'pv.classes': [
    'Quand vous rejoignez une classe, son professeur voit votre nom et votre adresse e-mail. Quand vous commencez un devoir, votre copie est dans votre bibliothèque et le professeur peut l’ouvrir, la commenter et la modifier. Votre avancement, ainsi que le commentaire, la note et les appréciations du professeur sont conservés avec la classe. Si le professeur supprime la classe, ces informations disparaissent ; votre copie du travail reste dans votre bibliothèque.',
    'Cuando te unes a una clase, su profesor ve tu nombre y tu correo. Cuando empiezas una tarea, tu copia está en tu biblioteca y el profesor puede abrirla, comentarla y editarla. Tu estado, los comentarios, la nota y las calificaciones del profesor se guardan con la clase. Si el profesor elimina la clase, esos registros desaparecen; tu copia del trabajo sigue en tu biblioteca.',
    'Wenn Sie einer Klasse beitreten, sieht die Lehrkraft Ihren Namen und Ihre E-Mail-Adresse. Wenn Sie eine Aufgabe beginnen, liegt Ihre Kopie in Ihrer Bibliothek, und die Lehrkraft kann sie öffnen, kommentieren und bearbeiten. Ihr Stand sowie Rückmeldung, Note und Bewertungen der Lehrkraft werden mit der Klasse gespeichert. Löscht die Lehrkraft die Klasse, verschwinden diese Einträge; Ihre Kopie der Arbeit bleibt in Ihrer Bibliothek.',
  ],
  'pv.h.sharing': ['Partage et communauté', 'Compartir y comunidad', 'Teilen und Community'],
  'pv.sharing': [
    'Les partitions sont <b>privées</b> par défaut. Une partition <b>non répertoriée</b> peut être vue et écoutée par toute personne qui a son lien. Une partition <b>publique</b> apparaît aussi dans Partitions partagées et sur votre profil public, avec votre nom. Vous pouvez la rendre privée à tout moment. Vos commentaires sur les partitions partagées sont publics, avec votre nom. Les « j’aime » sont comptés ; on ne voit pas qui a aimé. Si vous signalez quelque chose, seuls les administrateurs du site le savent.',
    'Las partituras son <b>privadas</b> por defecto. Una partitura <b>no listada</b> puede verla y escucharla cualquiera que tenga su enlace. Una <b>pública</b> aparece además en Explorar y en tu perfil público, con tu nombre. Puedes volver a hacerla privada cuando quieras. Tus comentarios en partituras compartidas son públicos, con tu nombre. Los «me gusta» se cuentan; no se muestra quién los dio. Si denuncias algo, solo los administradores del sitio lo saben.',
    'Partituren sind standardmäßig <b>privat</b>. Eine <b>nicht gelistete</b> Partitur kann jeder mit dem Link sehen und anhören. Eine <b>öffentliche</b> erscheint zusätzlich unter „Noten entdecken“ und auf Ihrem öffentlichen Profil mit Ihrem Namen. Sie können sie jederzeit wieder privat machen. Ihre Kommentare zu geteilten Partituren sind öffentlich, mit Ihrem Namen. „Gefällt mir“ wird gezählt; wer etwas mag, wird nicht angezeigt. Wenn Sie etwas melden, sehen das nur die Admins der Website.',
  ],
  'pv.h.email': ['E-mail', 'Correo', 'E-Mail'],
  'pv.email': [
    'Nous ne vous écrivons que si le site a activé l’e-mail, et seulement pour des copies de vos notifications (une par événement ou un résumé quotidien, au choix). Vous pouvez couper les e-mails dans le panneau 🔔 de l’éditeur.',
    'Solo te escribimos si el sitio tiene el correo activado, y solo copias de tus notificaciones (una por aviso o un resumen diario, como prefieras). Puedes desactivar los correos en el panel 🔔 del editor.',
    'Wir schreiben Ihnen nur, wenn die Website E-Mail eingeschaltet hat, und nur Kopien Ihrer Benachrichtigungen (eine je Ereignis oder eine tägliche Zusammenfassung, wie Sie wählen). Sie können E-Mails im 🔔-Bereich des Editors abschalten.',
  ],
  'pv.h.scan': ['Numériser des partitions', 'Escanear partituras', 'Noten scannen'],
  'pv.scan': [
    'Si vous numérisez une page de musique, l’image ou le PDF est envoyé au serveur du site, transformé en notes, puis supprimé aussitôt. Seule la partition obtenue s’ouvre dans votre éditeur.',
    'Si escaneas una página de música, la imagen o el PDF se envía al servidor del sitio, se convierte allí en notas y se borra enseguida. Solo la partitura resultante se abre en tu editor.',
    'Wenn Sie eine Notenseite scannen, wird das Bild oder PDF an den Server der Website geschickt, dort in Noten umgewandelt und sofort gelöscht. Nur die erkannte Partitur öffnet sich in Ihrem Editor.',
  ],
  'pv.h.cookies': ['Cookies', 'Cookies', 'Cookies'],
  'pv.cookies': [
    'Nous utilisons un seul cookie de session pour vous garder connecté. Pas de cookies publicitaires ou de suivi, ni d’outil d’analyse tiers.',
    'Usamos una sola cookie de sesión para mantener tu sesión iniciada. No usamos cookies de publicidad ni de seguimiento, ni analítica de terceros.',
    'Wir verwenden ein einziges Sitzungs-Cookie, damit Sie angemeldet bleiben. Keine Werbe- oder Tracking-Cookies und keine Analysedienste Dritter.',
  ],
  'pv.h.rights': ['Vos droits', 'Tus derechos', 'Ihre Rechte'],
  'pv.rights': [
    'Dans le menu du compte de l’éditeur, vous pouvez <b>télécharger vos données</b> (tout ce qui précède, en un fichier) et <b>supprimer votre compte</b>. La suppression efface définitivement votre bibliothèque, vos partitions partagées, les classes que vous enseignez, votre travail dans les classes, vos commentaires, vos « j’aime » et vos notifications. Vous pouvez aussi supprimer une partition à tout moment.',
    'En el menú de cuenta del editor puedes <b>descargar tus datos</b> (todo lo anterior, en un archivo) y <b>eliminar tu cuenta</b>. Eliminarla borra para siempre tu biblioteca, tus partituras compartidas, las clases que impartes, tu trabajo en clases, tus comentarios, «me gusta» y notificaciones. También puedes borrar partituras sueltas cuando quieras.',
    'Im Kontomenü des Editors können Sie <b>Ihre Daten herunterladen</b> (alles oben Genannte, als eine Datei) und <b>Ihr Konto löschen</b>. Das Löschen entfernt endgültig Ihre Bibliothek, geteilten Partituren, die Klassen, die Sie unterrichten, Ihre Arbeit in Klassen, Kommentare, „Gefällt mir“-Angaben und Benachrichtigungen. Einzelne Partituren können Sie jederzeit löschen.',
  ],
  'pv.operator': [
    'Cette page décrit le fonctionnement du logiciel Pianissimo. Toute personne qui exploite un site Pianissimo doit la relire et y ajouter ses coordonnées et les obligations légales qui s’appliquent. Traduction fournie pour commodité : la version anglaise fait foi.',
    'Esta página describe cómo funciona el software Pianissimo. Quien gestione un sitio Pianissimo debe revisarla y añadir sus datos de contacto y los requisitos legales que le correspondan. Traducción ofrecida por comodidad: la versión inglesa es la de referencia.',
    'Diese Seite beschreibt, wie die Software Pianissimo arbeitet. Wer eine Pianissimo-Website betreibt, sollte sie prüfen und eigene Kontaktdaten sowie geltende rechtliche Pflichten ergänzen. Übersetzung zur Erleichterung: Maßgeblich ist die englische Fassung.',
  ],

  // ---------------------------------------------------------------- terms
  'tm.title': ['Conditions d’utilisation', 'Condiciones de uso', 'Nutzungsbedingungen'],
  'tm.lead': [
    'En bref : votre musique vous appartient. Soyez respectueux dans ce que vous partagez.',
    'En resumen: tu música es tuya. Sé respetuoso con lo que compartes.',
    'Kurz gesagt: Ihre Musik gehört Ihnen. Seien Sie respektvoll mit dem, was Sie teilen.',
  ],
  'tm.h.content': ['Votre contenu', 'Tu contenido', 'Ihre Inhalte'],
  'tm.content': [
    'Vous gardez tous les droits sur la musique que vous écrivez. En rendant une partition non répertoriée ou publique, vous permettez à d’autres de la voir et de l’écouter dans Pianissimo, de la copier dans leur éditeur et de la <b>remixer</b> : faire leur propre version, qui peut être partagée en citant votre original. Si vous ne le souhaitez pas, gardez la partition privée.',
    'Conservas todos los derechos sobre la música que escribes. Al hacer una partitura no listada o pública permites que otros la vean y escuchen en Pianissimo, la copien en su editor y la <b>remezclen</b>: hagan su propia versión, que puede compartirse citando tu original. Si no lo quieres, mantén la partitura privada.',
    'Sie behalten alle Rechte an der Musik, die Sie schreiben. Wenn Sie eine Partitur nicht gelistet oder öffentlich machen, erlauben Sie anderen, sie in Pianissimo anzusehen und anzuhören, in ihren Editor zu kopieren und zu <b>remixen</b>: eine eigene Fassung zu machen, die mit Nennung Ihres Originals geteilt werden darf. Wenn Sie das nicht möchten, lassen Sie die Partitur privat.',
  ],
  'tm.h.share': ['Ce que vous pouvez partager et écrire', 'Qué puedes compartir y escribir', 'Was Sie teilen und schreiben dürfen'],
  'tm.share': [
    `<li>Ne partagez et ne numérisez que de la musique que vous avez écrite, du domaine public ou que vous avez le droit d’utiliser.</li>
     <li>Ne partagez pas de contenu et n’écrivez pas de commentaires illégaux, haineux, harcelants ou qui violent les droits d’autrui.</li>
     <li>Tout le monde peut signaler un commentaire ou une partition partagée. Le contenu signalé peut être masqué automatiquement et examiné par les administrateurs du site, qui peuvent supprimer des commentaires ou rendre des partitions privées.</li>`,
    `<li>Comparte y escanea solo música que hayas escrito, de dominio público o que tengas permiso para usar.</li>
     <li>No compartas contenido ni escribas comentarios ilegales, de odio, acosadores o que infrinjan derechos de otros.</li>
     <li>Cualquiera puede denunciar un comentario o una partitura compartida. El contenido denunciado puede ocultarse automáticamente y revisarlo los administradores del sitio, que pueden borrar comentarios o hacer privadas las partituras.</li>`,
    `<li>Teilen und scannen Sie nur Musik, die Sie selbst geschrieben haben, die gemeinfrei ist oder die Sie verwenden dürfen.</li>
     <li>Teilen Sie keine Inhalte und schreiben Sie keine Kommentare, die rechtswidrig, hasserfüllt oder belästigend sind oder Rechte anderer verletzen.</li>
     <li>Jeder kann einen Kommentar oder eine geteilte Partitur melden. Gemeldete Inhalte können automatisch ausgeblendet und von den Admins der Website geprüft werden, die Kommentare löschen oder Partituren privat machen können.</li>`,
  ],
  'tm.h.classes': ['Classes', 'Clases', 'Klassen'],
  'tm.classes': [
    'Les professeurs sont responsables des classes qu’ils créent et des devoirs qu’ils donnent. Le travail des élèves dans une classe peut être ouvert, commenté et modifié par le professeur.',
    'Los profesores son responsables de las clases que crean y de las tareas que ponen. El profesor puede abrir, comentar y editar el trabajo de los alumnos en una clase.',
    'Lehrkräfte sind für die Klassen verantwortlich, die sie anlegen, und für die Aufgaben, die sie stellen. Die Arbeiten der Schüler in einer Klasse kann die Lehrkraft öffnen, kommentieren und bearbeiten.',
  ],
  'tm.h.service': ['Le service', 'El servicio', 'Der Dienst'],
  'tm.service': [
    'Pianissimo est fourni tel quel, sans garantie. Gardez vos propres sauvegardes des partitions importantes : <b>Télécharger</b>, l’export MusicXML ou <b>Télécharger mes données</b>. Vous pouvez supprimer votre compte à tout moment depuis le menu du compte.',
    'Pianissimo se ofrece tal cual, sin garantías. Guarda tus propias copias de las partituras importantes: <b>Descargar</b>, la exportación MusicXML o <b>Descargar mis datos</b>. Puedes eliminar tu cuenta cuando quieras desde el menú de cuenta.',
    'Pianissimo wird ohne Gewähr bereitgestellt. Sichern Sie wichtige Partituren selbst: <b>Herunterladen</b>, MusicXML-Export oder <b>Meine Daten herunterladen</b>. Ihr Konto können Sie jederzeit im Kontomenü löschen.',
  ],
  'tm.operator': [
    'Ceci est un modèle de départ. Toute personne qui exploite un site Pianissimo doit relire ces conditions et y ajouter son nom, ses coordonnées et le droit applicable. Traduction fournie pour commodité : la version anglaise fait foi.',
    'Esto es una plantilla inicial. Quien gestione un sitio Pianissimo debe revisar estas condiciones y añadir su nombre, datos de contacto y la ley aplicable. Traducción ofrecida por comodidad: la versión inglesa es la de referencia.',
    'Dies ist eine Vorlage. Wer eine Pianissimo-Website betreibt, sollte diese Bedingungen prüfen und Namen, Kontaktdaten und anwendbares Recht ergänzen. Übersetzung zur Erleichterung: Maßgeblich ist die englische Fassung.',
  ],
};
