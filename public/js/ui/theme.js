// theme.js — Podany ThemeManager
// Manages light/dark/system theming via data-theme on <html>.

export class ThemeManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.storage = app.storage;
  }

  init() {
    const saved = this.storage.loadTheme();
    this.apply(saved);
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const current = this.storage.loadTheme();
        if (current === 'system') {
          this.apply('system');
        }
      });
    }
  }

  wireThemeButtons() {
    if (!this.elements.themeBtns) return;
    this.elements.themeBtns.forEach(btn => {
      btn.addEventListener('click', () => this.set(btn.dataset.themeVal));
    });
  }

  apply(theme) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (this.elements.themeBtns) {
      this.elements.themeBtns.forEach(btn => {
        if (btn.dataset.themeVal === theme) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  }

  set(theme) {
    this.storage.saveTheme(theme);
    this.apply(theme);
  }
}

export default ThemeManager;
