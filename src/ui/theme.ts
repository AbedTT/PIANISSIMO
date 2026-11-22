/** Light / dark / follow-the-system colour theme, remembered per browser. */
export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'pianissimo:theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function themeChoice(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

/** The theme actually shown. */
export function effectiveTheme(choice = themeChoice()): 'light' | 'dark' {
  return choice === 'auto' ? (media?.matches ? 'dark' : 'light') : choice;
}

export function applyTheme(choice = themeChoice()) {
  document.documentElement.dataset.theme = effectiveTheme(choice);
  document.documentElement.style.colorScheme = effectiveTheme(choice);
}

export function setTheme(choice: ThemeChoice) {
  if (choice === 'auto') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
  applyTheme(choice);
}

/** Light ↔ dark (from "auto" it switches to the opposite of what is shown now). */
export function toggleTheme(): 'light' | 'dark' {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme() {
  applyTheme();
  media?.addEventListener('change', () => {
    if (themeChoice() === 'auto') applyTheme();
  });
}
