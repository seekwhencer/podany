// player-ui.js — Podany PlayerUI
// Wires the show/hide (collapse ↔ expand) controls for the audio player and
// the auto-collapse-on-scroll behaviour. The actual collapsed state lives in
// PlaybackManager.setPlayerCollapsed; this class only owns the DOM events.

export class PlayerUI {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.scrollCollapseTimer = null;
  }

  wireControls() {
    if (this.elements.btnCollapsePlayer) {
      this.elements.btnCollapsePlayer.addEventListener('click', () => this.app.playback.setPlayerCollapsed(true));
    }
    if (this.elements.miniToggle) {
      this.elements.miniToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.playback.setPlayerCollapsed(false);
      });
    }
    if (this.elements.miniExpandZone) {
      this.elements.miniExpandZone.addEventListener('click', () => this.app.playback.setPlayerCollapsed(false));
      this.elements.miniExpandZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.app.playback.setPlayerCollapsed(false);
        }
      });
    }
    if (this.elements.miniPlayToggle) {
      this.elements.miniPlayToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.elements.btnPlayToggle) this.elements.btnPlayToggle.click();
      });
    }
  }

  wireScrollCollapse() {
    window.addEventListener('scroll', () => {
      if (this.scrollCollapseTimer) return;
      this.scrollCollapseTimer = setTimeout(() => {
        this.scrollCollapseTimer = null;
        if (document.body.classList.contains('has-active-episode')) {
          if (window.scrollY > 200 && !document.body.classList.contains('has-mini-player')) {
            this.app.playback.setPlayerCollapsed(true);
          }
        }
      }, 100);
    }, { passive: true });
  }

  init() {
    this.wireControls();
    this.wireScrollCollapse();
  }
}

export default PlayerUI;
