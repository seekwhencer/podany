// theme.js — Podany ThemeService (DOM-free service)
// Persists the chosen theme and publishes it to AppState. All DOM theming
// (data-theme on <html>, active-button highlight) is owned by ThemeComponent
// (FRONTEND_REFACTORING_COMPONENTS.md §4.2 / §14). This service has no DOM
// knowledge; it only persists + notifies and delegates the projection.

export class ThemeService {
	constructor(app) {
		this.app = app;
		this.state = app.state;
		this.storage = app.storage;
	}

	init() {
		// ThemeComponent.onMount() applies the saved theme on boot. Kept for
		// backward compatibility; the projection is idempotent.
		const saved = this.storage ? this.storage.loadTheme() : 'system';
		this._apply(saved);
	}

	// Theme buttons are owned by ThemeComponent (its own this.el). This service
	// is DOM-free; the wiring is a no-op kept for backward compatibility.
	wireThemeButtons() { }

	// DOM-free: persist the choice and publish it. ThemeComponent projects
	// data-theme onto <html> and highlights the active button.
	set(theme) {
		if (this.storage) this.storage.saveTheme(theme);
		this.state.theme = theme;
		this.state.notify('theme');
		this._apply(theme);
	}

	// Project data-theme onto <html>. Delegates to ThemeComponent when present
	// (single DOM owner); falls back to a local projection for the boot window
	// before ThemeComponent mounts.
	_apply(theme) {
		const tc = this.app && this.app.themeComponent;
		if (tc && typeof tc.apply === 'function') {
			tc.apply(theme);
			return;
		}
		if (typeof document !== 'undefined' && document.documentElement) {
			if (theme === 'system') {
				document.documentElement.removeAttribute('data-theme');
			} else {
				document.documentElement.setAttribute('data-theme', theme);
			}
		}
	}
}

export default ThemeService;
