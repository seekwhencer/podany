// queue.js — Podany QueueService
// Manages the "Up Next" queue: persistence and state. The queue badge + modal
// are owned by QueueModalComponent (R5), which re-renders from the 'queue' /
// 'currentEpisode' AppState subscriptions. This service is DOM-free.

export class QueueService {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.storage = app.storage;
    }

    loadQueue() {
        this.state.queue = this.storage.loadQueue();
        this.state.notify('queue');
    }

    saveQueue() {
        this.storage.saveQueue(this.state.queue);
    }

    isEpisodeQueued(id) {
        if (!Array.isArray(this.state.queue)) return false;
        return this.state.queue.some(ep => String(ep.id) === String(id));
    }

    toggleEpisodeQueue(episode) {
        const idx = this.state.queue.findIndex(ep => String(ep.id) === String(episode.id));
        if (idx !== -1) {
            this.state.queue.splice(idx, 1);
        } else {
            this.state.queue.push(episode);
        }
        this.state.notify('queue');
        this.saveQueue();
        this.updateQueueUI();
    }

    removeFromQueue(id) {
        this.state.queue = this.state.queue.filter(ep => String(ep.id) !== String(id));
        this.state.notify('queue');
        this.saveQueue();
        this.updateQueueUI();
    }

    clearQueue() {
        this.state.queue = [];
        this.state.notify('queue');
        this.saveQueue();
        this.updateQueueUI();
    }

    // The queue badge + modal are owned by QueueModalComponent (R5), which
    // re-renders from the 'queue' / 'currentEpisode' AppState subscriptions.
    // This service only manages queue state + persistence; the projection is a
    // no-op kept for backward compatibility with the many call sites.
    updateQueueUI() { }

    openQueueModal() {
        if (this.app && this.app.modal && typeof this.app.modal.openQueueModal === 'function') {
            this.app.modal.openQueueModal();
        }
    }

    closeQueueModal() {
        if (this.app && this.app.modal && typeof this.app.modal.closeQueueModal === 'function') {
            this.app.modal.closeQueueModal();
        }
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    // The legacy static queue buttons are owned by QueueModalComponent (R5).
    // This service is DOM-free; the wiring is a no-op kept for compatibility.
    wireEvents() { }
}

export default QueueService;
