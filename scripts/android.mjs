// The Android app, with no extra dependencies (no Gradle, no Android Studio):
//
//   npm run android            (builds the site first; `npm run package` makes it too, when it can)
//
// release/Pianissimo-<version>.apk   install on a phone or tablet (Android 10 or newer)
//
// Needs a JDK 17+ (javac, keytool) and the Android SDK's build tools and one platform, found through
// JAVA_HOME / PATH and ANDROID_HOME / ANDROID_SDK_ROOT (or the default SDK folder of Android Studio).
// The app (desktop/android) shows the built editor from inside the APK: it works without a network
// or a server. The piano's samples are put in the APK, downloaded once into build/android-cache.
//
// Signing: every update must be signed with the same key, or phones refuse to install it over the
// old one. The key is made the first time, in ~/.pianissimo/android-release.jks with its password
// next to it (android-release.password): keep both safe and backed up. Or set
// PIANISSIMO_ANDROID_KEYSTORE and PIANISSIMO_ANDROID_KEYSTORE_PASSWORD (alias PIANISSIMO_ANDROID_KEY_ALIAS,
// default "pianissimo") to use your own.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const src = join(root, 'desktop', 'android');
const dist = join(root, 'dist');
const work = join(root, 'build', 'android');
const cache = join(root, 'build', 'android-cache');
const release = join(root, 'release');
// --debug: a debuggable copy for testing (its page can be inspected from Chrome's chrome://inspect), kept in build/android
const debug = process.argv.includes('--debug');
const MIN_SDK = 29; // Android 10: saving into Downloads without a storage permission
const exe = process.platform === 'win32' ? '.exe' : '';

/** Exit code 2: the tools are missing (`npm run package` then skips the app); 1: the build failed. */
function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

// ------------------------------------------------------------------ tools
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk')].find(
  (d) => d && existsSync(join(d, 'build-tools')) && existsSync(join(d, 'platforms')),
);
if (!sdk) fail('The Android SDK was not found: install Android Studio (or the command-line tools) and set ANDROID_HOME.', 2);
const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });
const buildTools = readdirSync(join(sdk, 'build-tools')).filter((v) => existsSync(join(sdk, 'build-tools', v, `aapt2${exe}`))).sort(byVersion)[0];
const platform = readdirSync(join(sdk, 'platforms')).filter((p) => existsSync(join(sdk, 'platforms', p, 'android.jar'))).sort(byVersion)[0];
if (!buildTools || !platform) fail('The Android SDK needs its build tools and one platform (sdkmanager "build-tools;36.0.0" "platforms;android-36").', 2);
const bt = join(sdk, 'build-tools', buildTools);
const androidJar = join(sdk, 'platforms', platform, 'android.jar');
const targetSdk = Number.parseInt(platform.replace(/^android-/, ''), 10) || 35;

const jdkBin = [process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin'), ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')].find(
  (d) => d && existsSync(join(d, `javac${exe}`)),
);
if (!jdkBin) fail('A Java JDK (17 or newer, with javac) was not found: install one and set JAVA_HOME.', 2);
const java = join(jdkBin, `java${exe}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim());
    throw new Error(`${cmd} ${args.find((a) => !a.startsWith('-')) ?? ''} failed`);
  }
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

if (!existsSync(join(dist, 'app.html'))) fail('No build found: run `npm run build` first (or `npm run android`, which builds).');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(release, { recursive: true });

// ------------------------------------------------------------------ resources and manifest
const res = join(work, 'res');
cpSync(join(src, 'res'), res, { recursive: true });
mkdirSync(join(res, 'drawable-nodpi'), { recursive: true });
cpSync(join(root, 'public', 'icons', 'icon-maskable-512.png'), join(res, 'drawable-nodpi', 'icon_maskable.png'));
const aapt2 = join(bt, `aapt2${exe}`);
run(aapt2, ['compile', '--dir', res, '-o', join(work, 'res.zip')]);
const [major = 0, minor = 0, patch = 0] = version.split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
const versionCode = major * 10000 + minor * 100 + patch;
const base = join(work, 'base.apk');
run(aapt2, [
  'link', '-o', base, '-I', androidJar, '--manifest', join(src, 'AndroidManifest.xml'),
  '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(targetSdk),
  '--version-code', String(versionCode), '--version-name', version, ...(debug ? ['--debug-mode'] : []), join(work, 'res.zip'),
]);

// ------------------------------------------------------------------ code
const javaFiles = (function walkJava(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkJava(join(dir, d.name)) : d.name.endsWith('.java') ? [join(dir, d.name)] : []));
})(join(src, 'src'));
const classes = join(work, 'classes');
mkdirSync(classes);
// the JDK's own classes (lambdas need them) plus Android's; d8 turns the result into Android code
run(join(jdkBin, `javac${exe}`), ['--release', '11', '-encoding', 'UTF-8', '-classpath', androidJar, '-d', classes, ...javaFiles]);
const classFiles = (function walkClass(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkClass(join(dir, d.name)) : d.name.endsWith('.class') ? [join(dir, d.name)] : []));
})(classes);
const dex = join(work, 'dex');
mkdirSync(dex);
run(java, ['-cp', join(bt, 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--release', '--min-api', String(MIN_SDK), '--lib', androidJar, '--output', dex, ...classFiles]);

// ------------------------------------------------------------------ the piano's samples (src/audio/player.ts salamanderUrls)
const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const salamander = [];
for (let o = 1; o <= 7; o++) for (const n of ['A', 'C', 'Ds', 'Fs']) salamander.push(`${n}${o}.mp3`);
const sampleDir = join(cache, 'tonejs.github.io', 'audio', 'salamander');
mkdirSync(sampleDir, { recursive: true });
for (const name of salamander) {
  const file = join(sampleDir, name);
  if (existsSync(file) && statSync(file).size > 1000) continue;
  const r = await fetch(SALAMANDER + name);
  const data = Buffer.from(await r.arrayBuffer());
  // an MP3 starts with an ID3 tag or a frame sync
  if (!r.ok || data.length < 1000 || !(data.subarray(0, 3).toString('latin1') === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0))) {
    fail(`Could not download the piano sample ${name} (${r.status}). Check the internet connection and run it again.`);
  }
  writeFileSync(file, data);
}

// ------------------------------------------------------------------ the APK
/** The entries of a zip file, uncompressed: [name, data]. */
function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    out.push([name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw)]);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** A zip file; `stored` entries are kept uncompressed (Android maps resources.arsc straight from the APK). */
function zip(entries, stored = () => false) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // a fixed date: the same sources give the same APK
  const time = 0;
  const date = (2020 - 1980) << 9 | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = stored(name) ? null : deflateRawSync(data, { level: 9 });
    const deflate = !!packed && packed.length < data.length;
    const body = deflate ? packed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
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
    central.writeUInt16LE(deflate ? 8 : 0, 10);
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
  const size = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function walk(dir, baseDir = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    return d.isDirectory() ? walk(full, baseDir) : [[relative(baseDir, full).split('\\').join('/'), full]];
  });
}

const entries = [
  ...unzip(readFileSync(base)),
  ...readdirSync(dex).filter((f) => f.endsWith('.dex')).map((f) => [f, readFileSync(join(dex, f))]),
  ['assets/android.js', readFileSync(join(src, 'android.js'))],
  // the website's files; its server settings and service worker are not used in the app
  ...walk(dist).filter(([rel]) => rel !== '.htaccess' && rel !== 'sw.js').map(([rel, full]) => [`assets/www/${rel}`, readFileSync(full)]),
  ...walk(cache).map(([rel, full]) => [`assets/samples/${rel}`, readFileSync(full)]),
];
const unsigned = join(work, 'unsigned.apk');
// already-compressed files are stored, which also lets Android read them without unpacking
writeFileSync(unsigned, zip(entries, (name) => name === 'resources.arsc' || /\.(mp3|png|jpe?g|webp|woff2?|gz)$/i.test(name)));
const aligned = join(work, 'aligned.apk');
run(join(bt, `zipalign${exe}`), ['-p', '-f', '4', unsigned, aligned]);

// ------------------------------------------------------------------ signing
const keyHome = join(homedir(), '.pianissimo');
const keystore = process.env.PIANISSIMO_ANDROID_KEYSTORE || join(keyHome, 'android-release.jks');
const passwordFile = join(dirname(keystore), 'android-release.password');
const alias = process.env.PIANISSIMO_ANDROID_KEY_ALIAS || 'pianissimo';
let password = process.env.PIANISSIMO_ANDROID_KEYSTORE_PASSWORD;
let madeKey = false;
if (!existsSync(keystore)) {
  if (process.env.PIANISSIMO_ANDROID_KEYSTORE) fail(`The signing key ${keystore} does not exist.`);
  mkdirSync(dirname(keystore), { recursive: true });
  password ??= randomBytes(18).toString('base64url');
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  run(join(jdkBin, `keytool${exe}`), [
    '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-alias', alias, '-keyalg', 'RSA', '-keysize', '4096',
    '-validity', '10000', '-dname', 'CN=Pianissimo', '-storepass:env', 'PIANISSIMO_KS_PASS', '-keypass:env', 'PIANISSIMO_KS_PASS',
  ], { env: { ...process.env, PIANISSIMO_KS_PASS: password } });
  madeKey = true;
}
password ??= existsSync(passwordFile) ? readFileSync(passwordFile, 'utf8').trim() : undefined;
if (!password) fail(`Set PIANISSIMO_ANDROID_KEYSTORE_PASSWORD: the password of ${keystore}.`);

const apk = debug ? join(work, `Pianissimo-${version}-debug.apk`) : join(release, `Pianissimo-${version}.apk`);
const apksigner = ['-jar', join(bt, 'lib', 'apksigner.jar')];
// the password goes through the environment, never on the command line
const signEnv = { env: { ...process.env, PIANISSIMO_KS_PASS: password } };
run(java, [...apksigner, 'sign', '--ks', keystore, '--ks-key-alias', alias, '--ks-pass', 'env:PIANISSIMO_KS_PASS', '--key-pass', 'env:PIANISSIMO_KS_PASS', '--out', apk, aligned], signEnv);
run(java, [...apksigner, 'verify', apk]);
rmSync(`${apk}.idsig`, { force: true });

console.log(`\nAndroid app (Android 10+, build tools ${buildTools}, ${platform}):`);
console.log(`  ${relative(root, apk)}  (${Math.round(statSync(apk).size / 1024).toLocaleString('en')} KB, version ${version}, code ${versionCode})`);
if (madeKey) {
  console.log(
    `\nA signing key was made: ${keystore}\n(its password is in ${passwordFile}).\n` +
      'Back both up somewhere safe: updates of the app must be signed with this same key.',
  );
}
