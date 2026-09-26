// queue.js — Podany QueueManager
// Manages the "Up Next" queue: persistence, UI badge, and the reorderable
// queue modal (drag + touch).

import { escapeHtml } from './utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from './config.js';

export class QueueManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.storage = app.storage;
  }

  loadQueue() {
    this.state.queue = this.storage.loadQueue();
  }

  saveQueue() {
    this.storage.saveQueue(this.state.queue);
  }

  isEpisodeQueued(guid) {
    if (!Array.isArray(this.state.queue)) return false;
    return this.state.queue.some(ep => ep.guid === guid);
  }

  toggleEpisodeQueue(episode) {
    const idx = this.state.queue.findIndex(ep => ep.guid === episode.guid);
    if (idx !== -1) {
      this.state.queue.splice(idx, 1);
    } else {
      this.state.queue.push(episode);
    }
    this.saveQueue();
    this.updateQueueUI();
  }

  removeFromQueue(guid) {
    this.state.queue = this.state.queue.filter(ep => ep.guid !== guid);
    this.saveQueue();
    this.updateQueueUI();
  }

  clearQueue() {
    this.state.queue = [];
    this.saveQueue();
    this.updateQueueUI();
  }

  updateQueueUI() {
    const count = Array.isArray(this.state.queue) ? this.state.queue.length : 0;
    if (this.elements.queueBadge) {
      if (count > 0) {
        this.elements.queueBadge.textContent = count;
        this.elements.queueBadge.classList.remove('hidden');
      } else {
        this.elements.queueBadge.classList.add('hidden');
      }
    }
    if (this.elements.queueCountBadge) {
      this.elements.queueCountBadge.textContent = count === 1 ? '1 episode' : `${count} episodes`;
    }

    const cards = document.querySelectorAll('.episode-card');
    cards.forEach(card => {
      const guid = card.dataset.guid;
      const qBtn = card.querySelector('.btn-queue-ep');
      if (qBtn) {
        const inQueue = this.isEpisodeQueued(guid);
        if (inQueue) {
          qBtn.classList.add('is-queued');
          qBtn.innerHTML = this.app.config.cardIcons.QUEUE_ADDED;
          qBtn.title = 'Remove from Up Next';
        } else {
          qBtn.classList.remove('is-queued');
          qBtn.innerHTML = this.app.config.cardIcons.QUEUE;
          qBtn.title = 'Add to Up Next';
        }
      }
    });

    if (this.elements.queueModal && !this.elements.queueModal.classList.contains('hidden')) {
      this.renderQueueModalContent();
    }
  }

  renderQueueModalContent() {
    if (!this.elements.queueNowPlayingContainer || !this.elements.queueItemsContainer) return;

    if (this.state.currentEpisode) {
      const cur = this.state.currentEpisode;
      this.elements.queueNowPlayingContainer.innerHTML = `
        <div class="queue-now-playing-card">
          <div class="queue-now-playing-label">Now Playing</div>
          <div class="queue-now-playing-row">
            <img class="queue-item-artwork" src="${artworkUrl(cur.image, 'thumb')}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
            <div class="queue-item-info">
              <div class="queue-item-title">${escapeHtml(cur.title)}</div>
              <div class="queue-item-meta">${cur.isYouTube ? 'YouTube' : escapeHtml(cur.podcastTitle)}</div>
            </div>
            <div class="queue-now-playing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      `;
    } else {
      this.elements.queueNowPlayingContainer.innerHTML = '';
    }

    this.elements.queueItemsContainer.innerHTML = '';
    if (!Array.isArray(this.state.queue) || this.state.queue.length === 0) {
      this.elements.queueItemsContainer.innerHTML = `
        <div class="queue-empty-box">
          <p>Your queue is empty</p>
          <span>Click the queue icon on any episode to queue it up next.</span>
        </div>
      `;
      return;
    }

    let draggedIndex = null;

    this.state.queue.forEach((ep, idx) => {
      const row = document.createElement('div');
      row.className = 'queue-item-row';
      row.dataset.guid = ep.guid;
      row.dataset.index = idx;
      row.draggable = true;
      row.innerHTML = `
        <span class="queue-drag-handle" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
        </span>
        <span class="queue-item-index">${idx + 1}</span>
        <img class="queue-item-artwork" src="${artworkUrl(ep.image, 'thumb')}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
        <div class="queue-item-info">
          <div class="queue-item-title">${escapeHtml(ep.title)}</div>
          <div class="queue-item-meta">${escapeHtml(ep.podcastTitle)}${ep.duration ? ` • ${escapeHtml(ep.duration)}` : ''}</div>
        </div>
        <div class="queue-item-actions">
          <button class="btn-queue-item-play" title="Play Now">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
          </button>
          <button class="btn-queue-item-remove" title="Remove from Queue">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;

      row.addEventListener('dragstart', (e) => {
        draggedIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
        setTimeout(() => row.classList.add('is-dragging'), 0);
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          row.classList.add('drag-over-above');
          row.classList.remove('drag-over-below');
        } else {
          row.classList.add('drag-over-below');
          row.classList.remove('drag-over-above');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-above', 'drag-over-below');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-above', 'drag-over-below');
        const fromIdx = draggedIndex !== null ? draggedIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIdx = idx;
        if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== toIdx) {
          const item = this.state.queue.splice(fromIdx, 1)[0];
          this.state.queue.splice(toIdx, 0, item);
          this.saveQueue();
          this.updateQueueUI();
          this.renderQueueModalContent();
        }
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging', 'drag-over-above', 'drag-over-below');
        draggedIndex = null;
      });

      const handle = row.querySelector('.queue-drag-handle');
      if (handle) {
        let touchCurrentRow = null;
        handle.addEventListener('touchstart', () => {
          draggedIndex = idx;
          row.classList.add('is-dragging');
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
          const touchY = e.touches[0].clientY;
          const target = document.elementFromPoint(e.touches[0].clientX, touchY);
          const targetRow = target ? target.closest('.queue-item-row') : null;
          document.querySelectorAll('.queue-item-row').forEach(r => r.classList.remove('drag-over-above', 'drag-over-below'));
          if (targetRow && targetRow !== row) {
            touchCurrentRow = targetRow;
            targetRow.classList.add('drag-over-above');
          }
        }, { passive: true });

        handle.addEventListener('touchend', () => {
          row.classList.remove('is-dragging');
          if (touchCurrentRow && draggedIndex !== null) {
            const toIdx = parseInt(touchCurrentRow.dataset.index, 10);
            if (!isNaN(toIdx) && toIdx !== draggedIndex) {
              const item = this.state.queue.splice(draggedIndex, 1)[0];
              this.state.queue.splice(toIdx, 0, item);
              this.saveQueue();
              this.updateQueueUI();
              this.renderQueueModalContent();
            }
          }
          document.querySelectorAll('.queue-item-row').forEach(r => r.classList.remove('drag-over-above', 'drag-over-below'));
          draggedIndex = null;
        });
      }

      row.querySelector('.btn-queue-item-play').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(ep.guid);
        this.app.playback.playEpisode(ep);
      });

      row.querySelector('.btn-queue-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(ep.guid);
      });

      this.elements.queueItemsContainer.appendChild(row);
    });
  }

  openQueueModal() {
    this.elements.queueModal.classList.remove('hidden');
    this.renderQueueModalContent();
    window.history.pushState({ modal: 'queue' }, '', window.location.hash);
  }

  closeQueueModal() {
    if (window.history.state && window.history.state.modal) {
      window.history.back();
    } else if (this.elements.queueModal) {
      this.elements.queueModal.classList.add('hidden');
    }
  }

  // ── Event wiring ────────────────────────────────────────────────────────

  wireEvents() {
    if (this.elements.btnOpenQueue) this.elements.btnOpenQueue.addEventListener('click', () => this.openQueueModal());
    if (this.elements.btnCloseQueue) this.elements.btnCloseQueue.addEventListener('click', () => this.closeQueueModal());
    if (this.elements.btnClearQueue) this.elements.btnClearQueue.addEventListener('click', () => this.clearQueue());
    if (this.elements.queueModal) {
      this.elements.queueModal.addEventListener('click', (e) => {
        if (e.target === this.elements.queueModal) this.closeQueueModal();
      });
    }
  }
}

export default QueueManager;
