// Desktop installers, with no extra dependencies:
//
//   npm run package
//
// release/Pianissimo-Setup-<version>.exe            Windows installer (per-user, no admin rights)
// release/Pianissimo-<version>-windows-portable.zip  the same program, unzip and run Pianissimo.exe
// release/Pianissimo-<version>-macos-linux.tar.gz    unpack and run `sh install.sh`
//
// The Windows programs (desktop/windows/*.cs) are compiled with the C# compiler that is part of the
// .NET Framework 4.x in every Windows 10/11, so the Windows files can only be built on Windows; on
// other systems only the macOS/Linux package is made. Zip, tar.gz and .ico files are written here.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { version } = pkg;
/** Where the installed app looks for new releases (see desktop/windows/Updater.cs). */
const updateFeed = pkg.pianissimo?.updateFeed ?? '';
const dist = join(root, 'dist');
const work = join(root, 'build', 'desktop');
const release = join(root, 'release');

if (!existsSync(join(dist, 'app.html'))) {
  console.error('No build found: run `npm run build` first (or `npm run package`, which builds).');
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(release, { recursive: true });

// ------------------------------------------------------------------ archive writers
/** Every file under `dir` as [path relative to dir with forward slashes, absolute path]. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    return d.isDirectory() ? walk(full, base) : [[relative(base, full).split('\\').join('/'), full]];
  });
}

/** A zip file from [name, data] entries (deflated, UTF-8 names). */
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** A gzipped tar (ustar) from [name, data, mode] entries; keeps the executable bits zip would lose. */
function tarGz(entries) {
  const blocks = [];
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  for (const [name, data, mode = 0o644] of entries) {
    const head = Buffer.alloc(512);
    let path = name;
    let prefix = '';
    if (Buffer.byteLength(path) > 100) {
      // ustar: split at a slash into a prefix (≤155 bytes) and a name (≤100 bytes)
      let at = -1;
      for (let i = path.indexOf('/'); i > 0; i = path.indexOf('/', i + 1)) {
        if (Buffer.byteLength(path.slice(i + 1)) <= 100) {
          at = i;
          break;
        }
      }
      if (at < 0 || Buffer.byteLength(path.slice(0, at)) > 155) throw new Error(`Path too long for tar: ${name}`);
      prefix = path.slice(0, at);
      path = path.slice(at + 1);
    }
    head.write(path, 0, 100, 'utf8');
    head.write(octal(mode, 8), 100, 'ascii');
    head.write(octal(0, 8), 108, 'ascii');
    head.write(octal(0, 8), 116, 'ascii');
    head.write(octal(data.length, 12), 124, 'ascii');
    head.write(octal(Math.floor(Date.now() / 1000), 12), 136, 'ascii');
    head.write('        ', 148, 'ascii');
    head.write('0', 156, 'ascii');
    head.write('ustar\0', 257, 'ascii');
    head.write('00', 263, 'ascii');
    head.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const b of head) sum += b;
    head.write(octal(sum, 7) + ' ', 148, 'ascii');
    blocks.push(head, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

/** A Windows .ico holding PNG images (supported since Windows Vista). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((png, i) => {
    const size = png.readUInt32BE(16);
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs]);
}

const kb = (file) => `${Math.round(statSync(file).size / 1024).toLocaleString('en')} KB`;
const appEntries = (prefix) => walk(dist).map(([rel, full]) => [`${prefix}app/${rel}`, readFileSync(full)]);
const made = [];

// ------------------------------------------------------------------ code signing (Windows)
/**
 * Sign a Windows program with Authenticode, when a code-signing certificate is set up:
 *   PIANISSIMO_SIGN_PFX=path\to\certificate.pfx  PIANISSIMO_SIGN_PASSWORD=…   (a certificate file), or
 *   PIANISSIMO_SIGN_THUMBPRINT=<sha1>   (one in the Windows certificate store, e.g. on a USB token)
 * PIANISSIMO_SIGN_TIMESTAMP picks the timestamp server (default DigiCert's; empty = none, for tests).
 * Signed programs show the publisher's name, and SmartScreen stops warning once the
 * certificate has a reputation (at once with an EV certificate). Without one, nothing is signed.
 */
const signing = process.env.PIANISSIMO_SIGN_PFX || process.env.PIANISSIMO_SIGN_THUMBPRINT;
const signtool = signing
  ? [process.env.SIGNTOOL, ...(() => {
      const kits = 'C:/Program Files (x86)/Windows Kits/10/bin';
      if (!existsSync(kits)) return [];
      return readdirSync(kits).filter((v) => /^10\./.test(v)).sort().reverse().map((v) => join(kits, v, 'x64', 'signtool.exe'));
    })()].find((f) => f && existsSync(f))
  : undefined;
if (signing && !signtool) throw new Error('A signing certificate is set, but signtool.exe was not found (install the Windows SDK or set SIGNTOOL)');

function sign(file) {
  if (!signing) return false;
  const timestamp = process.env.PIANISSIMO_SIGN_TIMESTAMP ?? 'http://timestamp.digicert.com';
  const args = [
    'sign', '/fd', 'SHA256', '/d', 'Pianissimo',
    // the "more information" link Windows shows with the signature (optional)
    ...(process.env.PIANISSIMO_SIGN_URL ? ['/du', process.env.PIANISSIMO_SIGN_URL] : []),
    ...(process.env.PIANISSIMO_SIGN_PFX
      ? ['/f', process.env.PIANISSIMO_SIGN_PFX, ...(process.env.PIANISSIMO_SIGN_PASSWORD ? ['/p', process.env.PIANISSIMO_SIGN_PASSWORD] : [])]
      : ['/sha1', process.env.PIANISSIMO_SIGN_THUMBPRINT]),
    ...(timestamp ? ['/tr', timestamp, '/td', 'SHA256'] : []),
    file,
  ];
  const r = spawnSync(signtool, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    // never print the arguments: they may hold the password
    console.error(`${r.stdout}${r.stderr}`.trim());
    throw new Error(`Signing ${relative(root, file)} failed`);
  }
  return true;
}

// ------------------------------------------------------------------ Windows
const csc = ['Framework64', 'Framework']
  .map((f) => join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe'))
  .find(existsSync);
if (process.platform === 'win32' && csc) {
  const src = join(root, 'desktop', 'windows');
  const icon = join(work, 'pianissimo.ico');
  writeFileSync(icon, ico([readFileSync(join(root, 'public', 'icons', 'icon-192.png'))]));
  const buildInfo = join(work, 'BuildInfo.cs');
  writeFileSync(
    buildInfo,
    `namespace Pianissimo { static class BuildInfo { public const string Version = "${version}"; public const string UpdateFeed = ${JSON.stringify(updateFeed)}; } }\n`,
  );
  const compile = (out, files, extra = []) => {
    const args = [
      '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', `/out:${out}`,
      `/win32icon:${icon}`, `/win32manifest:${join(src, 'app.manifest')}`,
      '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
      ...extra, ...files,
    ];
    const r = spawnSync(csc, args, { encoding: 'utf8' });
    const output = `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => l && !/only supports language versions up to C# 5|compiler is provided as part of the Microsoft|aka\.ms\/netcore/.test(l));
    if (r.status !== 0) {
      console.error(output.join('\n'));
      throw new Error(`Compiling ${out} failed`);
    }
    if (output.length) console.log(output.join('\n'));
  };

  const launcher = join(work, 'Pianissimo.exe');
  compile(launcher, [join(src, 'Common.cs'), join(src, 'Launcher.cs'), join(src, 'Updater.cs'), buildInfo], ['/r:System.Web.Extensions.dll']);
  sign(launcher); // before it goes into the installer and the zip
  const readme = Buffer.from(
    [
      `Pianissimo ${version} for Windows`,
      '',
      'Double-click Pianissimo.exe to start. It opens in its own window (Microsoft Edge or Google Chrome',
      'is used to show it) and works without an internet connection. Your scores are saved on this computer.',
      '',
      'Signing in, sharing and the online library need a Pianissimo server: put its address in',
      '%LOCALAPPDATA%\\Pianissimo\\settings.ini as   server=https://your-pianissimo-site.example',
      '',
    ].join('\r\n'),
  );
  const programEntries = (prefix) => [[`${prefix}Pianissimo.exe`, readFileSync(launcher)], [`${prefix}README.txt`, readme], ...appEntries(prefix)];

  const payload = join(work, 'payload.zip');
  writeFileSync(payload, zip(programEntries('')));
  const setup = join(release, `Pianissimo-Setup-${version}.exe`);
  compile(setup, [join(src, 'Common.cs'), join(src, 'Setup.cs'), buildInfo], [
    '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Management.dll', `/resource:${payload},payload.zip`,
  ]);
  sign(setup);
  made.push(setup);

  const portable = join(release, `Pianissimo-${version}-windows-portable.zip`);
  writeFileSync(portable, zip(programEntries('Pianissimo/')));
  made.push(portable);
} else {
  console.log('Skipping the Windows installer: it is compiled with the .NET Framework C# compiler, which only Windows has.');
}

// ------------------------------------------------------------------ macOS and Linux
{
  const unix = join(root, 'desktop', 'unix');
  const dir = `Pianissimo-${version}/`;
  const readme = Buffer.from(
    [
      `Pianissimo ${version} for macOS and Linux`,
      '',
      'Install:   sh install.sh',
      'Or run it without installing:   python3 pianissimo.py',
      '',
      'Needs Python 3.7+ (on a Mac: Apple\'s Command Line Tools, `xcode-select --install`).',
      'It opens in its own window when Chrome, Chromium, Edge or Brave is installed, otherwise in your browser.',
      'Your scores are saved on this computer. Signing in, sharing and the online library need a',
      'Pianissimo server: put   server=https://your-pianissimo-site.example   in settings.ini',
      '(macOS: ~/Library/Application Support/Pianissimo, Linux: ~/.local/share/pianissimo).',
      '',
    ].join('\n'),
  );
  const tar = join(release, `Pianissimo-${version}-macos-linux.tar.gz`);
  writeFileSync(
    tar,
    tarGz([
      [`${dir}pianissimo.py`, readFileSync(join(unix, 'pianissimo.py')), 0o755],
      [`${dir}install.sh`, readFileSync(join(unix, 'install.sh')), 0o755],
      [`${dir}uninstall.sh`, readFileSync(join(unix, 'uninstall.sh')), 0o755],
      [`${dir}icon.png`, readFileSync(join(root, 'public', 'icons', 'icon-512.png'))],
      [`${dir}VERSION`, Buffer.from(`${version}\n`)],
      [`${dir}README.txt`, readme],
      ...appEntries(dir),
    ]),
  );
  made.push(tar);
}

// latest.json: what a self-hosted update feed serves (pianissimo.updateFeed = https://…/latest.json).
// Put it next to the three files on your website. A GitHub feed does not need it.
{
  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
  const byName = (re) => made.find((f) => re.test(f));
  const setupFile = byName(/Setup-.*\.exe$/);
  const tarFile = byName(/macos-linux\.tar\.gz$/);
  const latest = {
    version,
    notes: process.env.PIANISSIMO_RELEASE_NOTES ?? '',
    ...(setupFile ? { windows: basename(setupFile) } : {}),
    ...(tarFile ? { macosLinux: basename(tarFile) } : {}),
    sha256: { ...(setupFile ? { windows: sha(setupFile) } : {}), ...(tarFile ? { macosLinux: sha(tarFile) } : {}) },
  };
  writeFileSync(join(release, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
}

console.log('\nDesktop packages:');
for (const f of made) console.log(`  ${relative(root, f)}  (${kb(f)})`);
if (process.platform === 'win32' && csc) {
  console.log(
    signing
      ? '\nThe Windows programs are signed.'
      : '\nThe Windows programs are not signed: Windows SmartScreen will say "unknown publisher".\n' +
          'To sign them, set PIANISSIMO_SIGN_PFX and PIANISSIMO_SIGN_PASSWORD (see docs/INSTALL.md, "Signing").',
  );
}
