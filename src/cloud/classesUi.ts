import { api, type Assignment, type CalendarItem, type ClassInfo, type ScoreAssignment, type ScoreMeta, type Submission } from './api';
import type { Cloud } from './ui';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS: Record<string, string> = { 'not started': 'not started', working: 'working on it', submitted: 'handed in', returned: 'returned' };
const MARK_WORDS = ['not yet', 'beginning', 'developing', 'good', 'excellent'];

/** The grade and the marks per criterion, as the student sees them. */
function resultHtml(s: Submission | null | undefined, rubric: string[]) {
  if (!s || s.status !== 'returned') return '';
  const marks = rubric
    .map((c, k) => (s.marks[k] === null || s.marks[k] === undefined ? '' : `<li>${esc(c)}: <b>${s.marks[k]}/4</b> <span class="hint">${MARK_WORDS[s.marks[k]!]}</span></li>`))
    .join('');
  return `${s.grade ? `<p class="grade">Grade: <b>${esc(s.grade)}</b></p>` : ''}${marks ? `<ul class="marks">${marks}</ul>` : ''}${s.feedback ? `<p class="feedback">💬 ${esc(s.feedback)}</p>` : ''}`;
}

/** An .ics calendar file with the due dates (all-day events). */
export function toIcs(items: CalendarItem[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
  const text = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const next = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pianissimo//Assignments//EN',
    ...items.flatMap((a) => [
      'BEGIN:VEVENT',
      `UID:pianissimo-assignment-${a.id}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(a.due_at)}`,
      `DTEND;VALUE=DATE:${next(a.due_at)}`,
      `SUMMARY:${text(`Due: ${a.title} (${a.class})`)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Teaching in the editor: the Classes dialog (create or join a class, set the current score as
 * an assignment, start and hand in work, see everyone's work and give it back with feedback)
 * and a banner over a score that is someone's work on an assignment.
 */
export function initClasses(cloud: Cloud, hooks: { toast(m: string): void; scoreTitle(): string }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'classesModal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'classesTitle');
  modal.innerHTML = `<div class="modal-card wide">
      <header><h2 id="classesTitle">Classes</h2><button class="close" data-close aria-label="Close">✕</button></header>
      <div id="classesBody" class="classes-body"></div>
    </div>`;
  document.body.append(modal);
  modal.querySelector('[data-close]')!.addEventListener('click', () => (modal.hidden = true));
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.hidden = true;
  });
  const body = modal.querySelector<HTMLElement>('#classesBody')!;
  const title = modal.querySelector<HTMLElement>('#classesTitle')!;

  const banner = document.getElementById('assignmentBanner')!;
  let current: ScoreAssignment | null = null;

  const fail = (ex: unknown) => hooks.toast((ex as Error).message);

  async function open(classId?: number): Promise<void> {
    if (!cloud.user) return cloud.showAuth('Sign in to teach a class or join one.', () => open(classId));
    modal.hidden = false;
    if (classId) return showClass(classId);
    showList();
  }

  // ---------------------------------------------------------------- list of classes
  async function showList() {
    title.textContent = 'Classes';
    body.innerHTML = '<p class="hint">Loading…</p>';
    let classes: ClassInfo[];
    try {
      classes = (await api.listClasses()).classes;
    } catch (ex) {
      body.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
      return;
    }
    const row = (c: ClassInfo) => `<button type="button" class="class-row" data-id="${c.id}">
        <b>${esc(c.name)}</b>
        <span class="hint">${c.role === 'teacher' ? `${c.students} ${c.students === 1 ? 'student' : 'students'} · code ${esc(c.join_code ?? '')}` : `teacher: ${esc(c.teacher)}`}</span>
      </button>`;
    const teach = classes.filter((c) => c.role === 'teacher');
    const learn = classes.filter((c) => c.role === 'student');
    const agenda = await api.calendar().then((r) => r.calendar, () => [] as CalendarItem[]);
    body.innerHTML = `${agendaHtml(agenda)}
      <section><h3>Classes you teach</h3>${teach.map(row).join('') || '<p class="hint">None yet.</p>'}
        <form id="classCreate" class="inline-form"><input name="name" placeholder="New class name, e.g. Year 9 music" maxlength="80" required aria-label="New class name" /><button class="primary small">Create class</button></form>
      </section>
      <section><h3>Classes you are in</h3>${learn.map(row).join('') || '<p class="hint">None yet.</p>'}
        <form id="classJoin" class="inline-form"><input name="code" placeholder="Class code from your teacher" maxlength="12" required aria-label="Class code" autocomplete="off" /><button class="small">Join</button></form>
      </section>`;
    body.querySelectorAll<HTMLButtonElement>('.class-row, .agenda-item').forEach((b) => b.addEventListener('click', () => showClass(Number(b.dataset.id))));
    body.querySelector('[data-act="ics"]')?.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([toIcs(agenda)], { type: 'text/calendar' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pianissimo-due-dates.ics';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    body.querySelector<HTMLFormElement>('#classCreate')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
      try {
        const { class: c } = await api.createClass(name.value);
        hooks.toast(`Class created. Students join with the code ${c.join_code}`);
        showClass(c.id);
      } catch (ex) {
        fail(ex);
      }
    });
    body.querySelector<HTMLFormElement>('#classJoin')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (e.target as HTMLFormElement).elements.namedItem('code') as HTMLInputElement;
      try {
        const { class: c } = await api.joinClass(code.value);
        hooks.toast(`You joined “${c.name}”`);
        showClass(c.id);
      } catch (ex) {
        fail(ex);
      }
    });
  }

  /** Due dates across all classes: overdue, this week, later. */
  function agendaHtml(items: CalendarItem[]) {
    if (!items.length) return '';
    const today = new Date().toISOString().slice(0, 10);
    const inWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const open = (a: CalendarItem) => (a.role === 'student' ? a.status !== 'submitted' && a.status !== 'returned' : a.done! < a.total!);
    const groups: [string, CalendarItem[]][] = [
      ['Overdue', items.filter((a) => a.due_at.slice(0, 10) < today && open(a))],
      ['This week', items.filter((a) => a.due_at.slice(0, 10) >= today && a.due_at.slice(0, 10) <= inWeek)],
      ['Later', items.filter((a) => a.due_at.slice(0, 10) > inWeek)],
    ];
    const row = (a: CalendarItem) => `<button type="button" class="agenda-item" data-id="${a.class_id}">
        <span class="agenda-date">${day(a.due_at)}</span><b>${esc(a.title)}</b> <span class="hint">${esc(a.class)}</span>
        <span class="status status-${(a.status ?? '').replace(' ', '-')}">${a.role === 'teacher' ? `${a.done}/${a.total} handed in` : STATUS[a.status ?? 'not started']}</span>
      </button>`;
    return `<section class="agenda"><h3>Due dates <button type="button" class="link-btn" data-act="ics">⤓ Add to my calendar (.ics)</button></h3>
      ${groups.filter(([, list]) => list.length).map(([name, list]) => `<h4 class="${name === 'Overdue' ? 'overdue' : ''}">${name}</h4>${list.map(row).join('')}`).join('') || '<p class="hint">Nothing due in the coming days.</p>'}
    </section>`;
  }

  // ---------------------------------------------------------------- one class
  async function showClass(id: number) {
    body.innerHTML = '<p class="hint">Loading…</p>';
    let c: ClassInfo;
    try {
      c = (await api.getClass(id)).class;
    } catch (ex) {
      body.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
      return;
    }
    title.textContent = c.name;
    const teacher = c.role === 'teacher';
    const link = teacher ? new URL(`app.html?join=${c.join_code}`, location.href).href : '';
    const assignments = c.assignments ?? [];
    const due = (a: Assignment) => (a.due_at ? ` · due ${day(a.due_at)}` : '');
    const item = (a: Assignment) => {
      const s = a.submission;
      const actions = teacher
        ? `<span class="hint">${a.counts!.submitted} handed in · ${a.counts!.working} working · ${a.counts!.returned} returned</span>
           <button class="small" data-act="work" data-id="${a.id}">See the work</button>`
        : `<span class="status status-${s?.status ?? 'none'}">${STATUS[s?.status ?? 'not started']}</span>
           <button class="small primary" data-act="start" data-id="${a.id}">${s ? 'Open' : 'Start'}</button>
           ${s && s.status === 'working' ? `<button class="small" data-act="submit" data-id="${a.id}">Hand in</button>` : ''}`;
      return `<li class="assignment">
          <div><b>${esc(a.title)}</b><span class="hint">${due(a)}</span>
          ${a.instructions ? `<p class="instructions">${esc(a.instructions)}</p>` : ''}
          ${a.rubric.length ? `<p class="hint">Marked on: ${a.rubric.map(esc).join(' · ')}</p>` : ''}
          ${teacher ? '' : resultHtml(s, a.rubric)}</div>
          <div class="assignment-actions">${actions}</div>
        </li>`;
    };
    body.innerHTML = `
      <p><button type="button" class="link-btn back" data-act="back">← All classes</button></p>
      ${teacher ? `<div class="join-box"><span>Students join with the code <b class="code">${esc(c.join_code ?? '')}</b> or this link:</span>
        <input readonly value="${esc(link)}" aria-label="Join link" /><button class="small" data-act="copy">Copy link</button></div>` : `<p class="hint">Teacher: ${esc(c.teacher)}</p>`}
      <h3>Assignments</h3>
      <ul class="assignment-list">${assignments.map(item).join('') || '<li class="hint">No assignments yet.</li>'}</ul>
      ${teacher ? `<form id="assignForm" class="assign-form">
          <h3>Set the score you are editing as an assignment</h3>
          <label>Title <input name="title" maxlength="120" required value="${esc(hooks.scoreTitle())}" /></label>
          <label>Instructions <textarea name="instructions" rows="3" maxlength="4000" placeholder="What should students do?"></textarea></label>
          <label>Due <input name="due" type="date" /></label>
          <label>Marking criteria <span class="hint">(optional, one per line, each marked 0–4)</span>
            <textarea name="rubric" rows="3" maxlength="700" placeholder="Right notes&#10;Neat rhythm&#10;Dynamics"></textarea></label>
          <button class="primary small">Set assignment</button>
          <p class="hint">Each student gets their own copy. You can open every copy, comment on bars and edit it with them.</p>
        </form>
        <h3>Students (${c.members?.length ?? 0})</h3>
        <ul class="member-list">${(c.members ?? []).map((m) => `<li>${esc(m.name)} <span class="hint">${esc(m.email)}</span></li>`).join('') || '<li class="hint">Nobody has joined yet.</li>'}</ul>
        <p><button class="small danger" data-act="delete">Delete this class</button></p>`
      : `<p><button class="small" data-act="leave">Leave this class</button></p>`}`;

    const on = (act: string, fn: (b: HTMLButtonElement) => void) =>
      body.querySelectorAll<HTMLButtonElement>(`[data-act="${act}"]`).forEach((b) => b.addEventListener('click', () => fn(b)));
    on('back', () => showList());
    on('copy', async () => {
      try {
        await navigator.clipboard.writeText(link);
        hooks.toast('Join link copied');
      } catch {
        body.querySelector<HTMLInputElement>('.join-box input')!.select();
      }
    });
    on('start', async (b) => {
      try {
        const { submission } = await api.startAssignment(Number(b.dataset.id));
        modal.hidden = true;
        await cloud.openScore(submission.score_id);
      } catch (ex) {
        fail(ex);
      }
    });
    on('submit', async (b) => {
      if (!confirm('Hand in this assignment? Your teacher will see it as finished.')) return;
      try {
        await api.submitAssignment(Number(b.dataset.id));
        hooks.toast('Handed in');
        showClass(id);
      } catch (ex) {
        fail(ex);
      }
    });
    on('work', (b) => showWork(c, assignments.find((a) => a.id === Number(b.dataset.id))!));
    on('delete', async () => {
      if (!confirm(`Delete “${c.name}”? Students keep their own copies of the work.`)) return;
      try {
        await api.deleteClass(id);
        showList();
      } catch (ex) {
        fail(ex);
      }
    });
    on('leave', async () => {
      if (!confirm(`Leave “${c.name}”? Your scores stay in your library.`)) return;
      try {
        await api.leaveClass(id, cloud.user!.id);
        showList();
      } catch (ex) {
        fail(ex);
      }
    });
    body.querySelector<HTMLFormElement>('#assignForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
      // the assignment is a copy of the score as it is in the library: save it first
      if ((!cloud.current || cloud.status === 'Unsaved changes') && !(await cloud.save())) return;
      try {
        await api.assign(id, {
          title: val('title'),
          instructions: val('instructions'),
          due_at: val('due') || null,
          score_id: cloud.current!.id,
          rubric: val('rubric').split('\n').map((x) => x.trim()).filter(Boolean),
        });
        hooks.toast('Assignment set: students see it in this class');
        showClass(id);
      } catch (ex) {
        fail(ex);
      }
    });
  }

  // ---------------------------------------------------------------- the teacher's view of everyone's work
  async function showWork(c: ClassInfo, a: Assignment) {
    title.textContent = `${c.name}: ${a.title}`;
    body.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const { submissions } = await api.submissions(a.id);
      body.innerHTML = `<p><button type="button" class="link-btn back" data-act="back">← ${esc(c.name)}</button></p>
        <table class="work-table"><tr><th>Student</th><th>Status</th><th></th></tr>
        ${submissions
          .map(
            (s) => `<tr><td>${esc(s.student.name)}</td><td><span class="status status-${s.status.replace(' ', '-')}">${STATUS[s.status] ?? s.status}</span>
              ${s.submitted_at ? `<span class="hint">${day(s.submitted_at)}</span>` : ''}</td>
              <td>${s.score_id ? `<button class="small primary" data-open="${s.score_id}">Open</button>` : ''}
              ${s.id ? `<button class="small" data-return="${s.id}">${s.status === 'returned' ? 'Change marks…' : 'Give back…'}</button>` : ''}
              ${s.grade ? `<span class="grade-chip">${esc(s.grade)}</span>` : ''}</td></tr>
              <tr class="giveback-row" data-for="${s.id ?? ''}" hidden><td colspan="3">${s.id ? giveBackForm(a.rubric, s as Submission) : ''}</td></tr>`,
          )
          .join('') || '<tr><td colspan="3" class="hint">No students in this class yet.</td></tr>'}</table>
        <p class="hint">Open a student's work to see it, play it and leave comments on bars (💬). Give it back with a few words of feedback.</p>`;
      body.querySelector('[data-act="back"]')!.addEventListener('click', () => showClass(c.id));
      body.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
        b.addEventListener('click', async () => {
          modal.hidden = true;
          await cloud.openScore(Number(b.dataset.open));
        }),
      );
      body.querySelectorAll<HTMLButtonElement>('[data-return]').forEach((b) =>
        b.addEventListener('click', () => {
          const row = body.querySelector<HTMLElement>(`.giveback-row[data-for="${b.dataset.return}"]`)!;
          row.hidden = !row.hidden;
          row.querySelector<HTMLTextAreaElement>('textarea')?.focus();
        }),
      );
      body.querySelectorAll<HTMLFormElement>('.giveback-form').forEach((f) =>
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const marks = a.rubric.map((_, k) => {
            const v = (f.elements.namedItem(`mark${k}`) as HTMLSelectElement).value;
            return v === '' ? null : Number(v);
          });
          const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
          try {
            await api.giveBack(Number(f.dataset.id), val('feedback'), val('grade'), marks);
            hooks.toast('Given back');
            showWork(c, a);
          } catch (ex) {
            fail(ex);
          }
        }),
      );
    } catch (ex) {
      body.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
    }
  }

  /** Feedback, grade and a 0–4 mark per criterion. */
  function giveBackForm(rubric: string[], s: Submission) {
    const options = (v: number | null | undefined) =>
      `<option value="">–</option>${MARK_WORDS.map((w, k) => `<option value="${k}" ${v === k ? 'selected' : ''}>${k} · ${w}</option>`).join('')}`;
    return `<form class="giveback-form" data-id="${s.id}">
        <label>Feedback <textarea name="feedback" rows="3" maxlength="4000">${esc(s.feedback ?? '')}</textarea></label>
        <div class="giveback-grid">
          ${rubric.map((c, k) => `<label>${esc(c)} <select name="mark${k}">${options(s.marks?.[k])}</select></label>`).join('')}
          <label>Grade <input name="grade" maxlength="20" placeholder="e.g. 8/10, B+" value="${esc(s.grade ?? '')}" /></label>
        </div>
        <button class="primary small">Give back</button>
      </form>`;
  }

  // ---------------------------------------------------------------- banner over assignment work
  function renderBanner() {
    const a = current;
    banner.hidden = !a;
    if (!a) return;
    const s = a.submission;
    banner.innerHTML = `<span class="banner-icon" aria-hidden="true">📚</span>
      <div class="banner-text"><b>${esc(a.title)}</b> <span class="hint">· ${esc(a.class)}${a.mine ? '' : ` · ${esc(a.student)}'s work`}${a.due_at ? ` · due ${day(a.due_at)}` : ''}</span>
        ${a.instructions ? `<div class="instructions">${esc(a.instructions)}</div>` : ''}
        ${a.mine ? resultHtml(s, a.rubric) : ''}</div>
      <span class="status status-${s.status}">${STATUS[s.status]}</span>
      ${a.mine && s.status === 'working' ? '<button class="small primary" data-act="handin">Hand in</button>' : ''}
      ${!a.mine && s.status !== 'returned' ? '<button class="small" data-act="giveback">Give back…</button>' : ''}`;
    banner.querySelector('[data-act="handin"]')?.addEventListener('click', async () => {
      if (!confirm('Hand in this assignment? Your teacher will see it as finished.')) return;
      if (cloud.status === 'Unsaved changes') await cloud.save();
      try {
        current = { ...a, submission: (await api.submitAssignment(a.id)).submission };
        renderBanner();
        hooks.toast('Handed in');
      } catch (ex) {
        fail(ex);
      }
    });
    banner.querySelector('[data-act="giveback"]')?.addEventListener('click', async () => {
      // marking happens in the class's work list, with this student's form open
      if (cloud.status === 'Unsaved changes') await cloud.save();
      try {
        const { class: c } = await api.getClass(a.class_id);
        const task = c.assignments?.find((x) => x.id === a.id);
        if (!task) return;
        modal.hidden = false;
        await showWork(c, task);
        const row = body.querySelector<HTMLElement>(`.giveback-row[data-for="${a.submission.id}"]`);
        if (row) row.hidden = false;
      } catch (ex) {
        fail(ex);
      }
    });
  }

  async function linked(meta: ScoreMeta | null) {
    current = null;
    renderBanner();
    if (!meta || !cloud.user) return;
    try {
      const { assignment } = await api.assignmentOf(meta.id);
      if (cloud.current?.id === meta.id) {
        current = assignment;
        renderBanner();
      }
    } catch {
      /* offline: no banner */
    }
  }
  const before = cloud.onLinked;
  cloud.onLinked = (meta) => {
    before(meta);
    void linked(meta);
  };

  /** app.html?join=CODE: join the class (after signing in), then show it. */
  async function joinFromLink(code: string): Promise<void> {
    if (!cloud.user) return cloud.showAuth('Sign in (or create a free account) to join the class.', () => joinFromLink(code));
    try {
      const { class: c } = await api.joinClass(code);
      hooks.toast(`You joined “${c.name}”`);
      void open(c.id);
    } catch (ex) {
      fail(ex);
    }
  }

  return { open, joinFromLink };
}
