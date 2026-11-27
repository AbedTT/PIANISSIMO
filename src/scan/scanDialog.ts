import { api } from '../cloud/api';
import { desktopInfo, type DesktopInfo } from '../desktop/updates';
import { t, translatePage } from '../ui/i18n';

/** What a scanner sends back: MusicXML (base64, plain or compressed .mxl) and a picture of each page. */
export interface ScanResult {
  format: 'mxl' | 'musicxml';
  data: string;
  pages?: string[];
}

export const AUDIVERIS_DOWNLOAD = 'https://github.com/Audiveris/audiveris/releases/latest';
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/tiff,.pdf,.png,.jpg,.jpeg,.tif,.tiff';

/** Files the scanner can read. */
export const isScannable = (file: File) => /\.(pdf|png|jpe?g|tiff?)$/i.test(file.name) || /^(application\/pdf|image\/(png|jpeg|tiff))$/.test(file.type);

/** The desktop app: Audiveris on this computer reads the page (no server, no account). */
export async function scanOnDesktop(file: File, signal?: AbortSignal): Promise<ScanResult> {
  const res = await fetch('/__desktop/scan', {
    method: 'POST',
    // the custom header: other websites cannot make this computer's launcher scan
    headers: { 'X-Pianissimo-Desktop': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as { result?: ScanResult; error?: string };
  if (!res.ok || !body.result) throw new Error(body.error ?? `Scanning failed (${res.status})`);
  return body.result;
}

type Where = { kind: 'desktop' } | { kind: 'server' } | { kind: 'none'; desktop: DesktopInfo | null };

/** Where scanning can happen: Audiveris in the desktop app, the site's server, or nowhere yet. */
async function findScanner(): Promise<Where> {
  const desktop = await desktopInfo();
  if (desktop?.scan) return { kind: 'desktop' };
  const server = await api.omrAvailable().then(
    (r) => r.available,
    () => false,
  );
  return server ? { kind: 'server' } : { kind: 'none', desktop };
}

/**
 * "Scan a page": choose (or drop) a PDF or picture of printed music; it comes back as a score to
 * edit, with the page shown beside it. Explains how to set up Audiveris when it is missing.
 */
export class ScanDialog {
  readonly el: HTMLElement;
  private where: Where | null = null;
  /** A page dropped or opened before the scanner was set up: read once it is. */
  private pending: File | null = null;
  private abort: AbortController | null = null;
  private timer = 0;

  constructor(
    private opts: {
      show: (el: HTMLElement) => void;
      hide: () => void;
      signedIn: () => boolean;
      askSignIn: (then: () => Promise<unknown>) => void;
      onScanned: (result: ScanResult, file: File) => Promise<void>;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'modal';
    this.el.id = 'scanModal';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="modal-card scan-card" role="dialog" aria-labelledby="scanTitle">
        <header><h2 id="scanTitle">Scan sheet music</h2><button class="close" data-close>✕</button></header>
        <div data-step="pick">
          <p class="hint">Turn a PDF, a scan or a photo of printed music into a score you can edit, play and transpose.</p>
          <label class="drop-zone" tabindex="0">
            <input type="file" accept="${ACCEPT}" hidden />
            <span class="drop-icon" aria-hidden="true">📄</span>
            <b>Choose a PDF or picture…</b>
            <span>or drop it here</span>
          </label>
          <p class="form-error" data-error hidden></p>
          <ul class="scan-tips">
            <li>Printed music works best: a PDF, or a straight, sharp photo of one page in good light.</li>
            <li>Handwritten music is not recognised well.</li>
            <li>Reading takes about half a minute per page. Then check the notes against the page, which is shown beside the score.</li>
          </ul>
        </div>
        <div data-step="busy" hidden>
          <div class="scan-busy"><span class="spinner" aria-hidden="true"></span><b>Reading the music…</b><span data-elapsed></span></div>
          <p class="hint">About half a minute per page. You can keep this window open; your current score is not changed until it is done.</p>
          <div class="form-actions"><button type="button" data-act="cancel">Cancel</button></div>
        </div>
        <div data-step="setup" hidden>
          <div data-setup="desktop">
            <div data-auto>
              <p>Scanning uses Audiveris, a free program that reads printed music. Pianissimo sets it up for you: one click, nothing else to install.</p>
              <p class="hint" data-size></p>
              <div class="scanner-progress" data-progress hidden>
                <progress max="100" value="0"></progress>
                <span data-progress-text></span>
              </div>
              <p class="form-error" data-setup-error hidden></p>
              <div class="form-actions"><button type="button" class="primary" data-act="autosetup">Set up the scanner</button></div>
            </div>
            <details class="scan-manual" data-manual>
            <summary>Or install Audiveris yourself</summary>
            <p>Scanning uses Audiveris, a free program that reads printed music. Install it once on this computer:</p>
            <ol class="scan-steps">
              <li><span>Open the Audiveris download page and download the file for your computer:</span> <b data-file></b></li>
              <li>Open the downloaded file and follow the installer (it brings everything Audiveris needs).</li>
              <li>Come back here and press “Check again”.</li>
            </ol>
            <div class="form-actions">
              <a class="button primary" href="${AUDIVERIS_DOWNLOAD}" target="_blank" rel="noopener">Open the Audiveris download page</a>
              <button type="button" data-act="recheck">Check again</button>
            </div>
            <p class="hint">Installed it somewhere else? Add a line audiveris= with the folder of Audiveris to Pianissimo’s settings.ini, then restart Pianissimo.</p>
            </details>
          </div>
          <div data-setup="web">
            <p>This website has no music scanner set up.</p>
            <p>Scanning works in the Pianissimo desktop app once the free program Audiveris is installed next to it, or on a Pianissimo website whose operator set up Audiveris on the server.</p>
            <div class="form-actions"><button type="button" data-act="recheck">Check again</button></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    translatePage(this.el);

    const input = this.el.querySelector<HTMLInputElement>('input[type=file]')!;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.scan(file);
    });
    const zone = this.el.querySelector<HTMLElement>('.drop-zone')!;
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('over');
      const file = e.dataTransfer?.files[0];
      if (file) void this.scan(file);
    });
    this.el.querySelectorAll('[data-act=recheck]').forEach((b) =>
      b.addEventListener('click', () => {
        this.where = null;
        void this.open();
      }),
    );
    this.el.querySelector('[data-act=autosetup]')!.addEventListener('click', () => void this.setUpScanner(true));
    this.el.querySelector('[data-act=cancel]')!.addEventListener('click', () => this.cancel());
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.cancel());
  }

  /** Open the dialog; with a file (dropped on the editor, or opened), start reading it at once. */
  async open(file?: File) {
    this.pending = file ?? null;
    this.where ??= await findScanner();
    const where = this.where;
    if (where.kind === 'server' && !this.opts.signedIn()) {
      this.where = null;
      this.opts.askSignIn(async () => this.open(file));
      return;
    }
    this.opts.show(this.el);
    if (where.kind === 'none') {
      this.step('setup');
      const desktop = where.desktop;
      (this.el.querySelector('[data-setup=desktop]') as HTMLElement).hidden = !desktop;
      (this.el.querySelector('[data-setup=web]') as HTMLElement).hidden = !!desktop;
      const fileName =
        desktop?.platform === 'macos'
          ? t('the .dmg file (arm64 for Apple silicon, x86_64 for Intel Macs)')
          : desktop?.platform === 'linux'
            ? t('the .deb file for Ubuntu or Debian (or install Audiveris from Flathub)')
            : t('the .msi file whose name ends in windows-x86_64.msi');
      this.el.querySelector('[data-file]')!.textContent = fileName;
      // the Windows app sets the scanner up itself; elsewhere the steps to install it are shown
      const auto = !!desktop?.scannerSetup;
      (this.el.querySelector('[data-auto]') as HTMLElement).hidden = !auto;
      const manual = this.el.querySelector<HTMLDetailsElement>('[data-manual]')!;
      manual.open = !auto;
      (manual.querySelector('summary') as HTMLElement).hidden = !auto;
      if (auto) {
        this.el.querySelector('[data-size]')!.textContent = t('It downloads about {mb} MB once, and is kept in Pianissimo’s folder (removing Pianissimo removes it too).').replace(
          '{mb}',
          String(desktop.scannerMegabytes ?? 85),
        );
        void this.setUpScanner(false); // already running (the dialog was closed meanwhile)? Show how far
      }
      return;
    }
    this.step('pick');
    this.error('');
    if (file) void this.scan(file);
    else (this.el.querySelector('.drop-zone') as HTMLElement).focus();
  }

  /**
   * "Set up the scanner": the launcher downloads Audiveris and unpacks it next to Pianissimo. With
   * start = false only show the progress of a setup that is already running.
   */
  private async setUpScanner(start: boolean) {
    const box = this.el.querySelector<HTMLElement>('[data-progress]')!;
    const bar = box.querySelector('progress')!;
    const label = this.el.querySelector<HTMLElement>('[data-progress-text]')!;
    const error = this.el.querySelector<HTMLElement>('[data-setup-error]')!;
    const button = this.el.querySelector<HTMLButtonElement>('[data-act=autosetup]')!;
    type Status = { state: 'idle' | 'working' | 'done' | 'error'; percent: number; message: string };
    const ask = async (method: 'GET' | 'POST'): Promise<Status> => {
      const res = await fetch('/__desktop/scanner/setup', { method, headers: method === 'POST' ? { 'X-Pianissimo-Desktop': '1' } : {} });
      if (!res.ok) throw new Error(`The scanner could not be set up (${res.status})`);
      return (await res.json()) as Status;
    };
    try {
      let status = await ask(start ? 'POST' : 'GET');
      if (!start && status.state !== 'working') return;
      error.hidden = true;
      button.hidden = true;
      box.hidden = false;
      while (status.state === 'working') {
        bar.value = status.percent;
        label.textContent = status.percent < 90 ? `${t('Downloading the music scanner…')} ${status.percent}%` : t('Unpacking the music scanner…');
        await new Promise((ok) => setTimeout(ok, 600));
        if (this.el.hidden) return; // closed: it carries on, and the dialog shows it when opened again
        status = await ask('GET');
      }
      if (status.state === 'error') throw new Error(status.message);
      bar.value = 100;
      label.textContent = t('The music scanner is ready.');
      // straight on to choosing the page (or reading the one that was dropped)
      this.where = null;
      await this.open(this.pending ?? undefined);
    } catch (err) {
      box.hidden = true;
      error.textContent = t((err as Error).message);
      error.hidden = false;
    } finally {
      button.hidden = false;
    }
  }

  private step(name: 'pick' | 'busy' | 'setup') {
    this.el.querySelectorAll<HTMLElement>('[data-step]').forEach((s) => (s.hidden = s.dataset.step !== name));
  }

  private error(msg: string) {
    const p = this.el.querySelector<HTMLElement>('[data-error]')!;
    p.textContent = msg;
    p.hidden = !msg;
  }

  private cancel() {
    this.abort?.abort();
    this.abort = null;
    clearInterval(this.timer);
    this.opts.hide();
  }

  private async scan(file: File) {
    if (!isScannable(file)) {
      this.step('pick');
      this.error(t('Scan a PDF, PNG, JPEG or TIFF file.'));
      return;
    }
    const where = this.where;
    if (!where || where.kind === 'none') return;
    this.step('busy');
    this.error('');
    const started = Date.now();
    const elapsed = this.el.querySelector<HTMLElement>('[data-elapsed]')!;
    elapsed.textContent = '';
    clearInterval(this.timer);
    this.timer = window.setInterval(() => (elapsed.textContent = `${Math.round((Date.now() - started) / 1000)} s`), 1000);
    const abort = (this.abort = new AbortController());
    try {
      const result = where.kind === 'desktop' ? await scanOnDesktop(file, abort.signal) : (await api.scanMusic(file)).result;
      // closed meanwhile (Esc, a click beside it): that was a "never mind"
      if (abort.signal.aborted || this.el.hidden) return;
      await this.opts.onScanned(result, file);
      this.opts.hide();
    } catch (err) {
      if (abort.signal.aborted) return;
      this.step('pick');
      this.error(t((err as Error).message));
    } finally {
      clearInterval(this.timer);
      if (this.abort === abort) this.abort = null;
    }
  }
}
