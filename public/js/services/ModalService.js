// modal.js — Podany ModalService
// DOM-free orchestrator / registry for the modal chrome. It owns no DOM of its
// own; the actual modals live in their own components (AddFeed, SleepTimer,
// ConfirmModal, QueueModal, Status), which mount themselves as shell chrome in
// AppShell and register with this service. This class only coordinates open/close,
// keeps the Escape modal-stack, resolves confirm dialogs, and runs the global
// reset flow. See FRONTEND_REFACTORING_COMPONENTS.md §2, §8, §15.3 (R5).
//
// Navigation was already removed (RouterService). Auth is owned by AuthFlowComponent
// (R7); this service no longer references the auth modal.

export class ModalService {
	constructor(app) {
		this.app = app;
		this.state = app.state;
		this.api = app.api;
		this.storage = app.storage;
		this.config = app.config;
		this.components = {};    // name -> mounted component
		this._stack = [];        // open real modals, innermost last (Escape stack)
		this._confirmChain = null; // { resolve } for the pending confirm dialog
	}

	// ── Registry ─────────────────────────────────────────────────────────────

	register(name, component) {
		this.components[name] = component;
	}

	// ── Modal stack (pure state, drives global Escape) ────────────────────────

	pushModal(component) {
		if (component && !this._stack.includes(component)) {
			this._stack.push(component);
		}
	}

	popModal(component) {
		if (!component) return;
		const idx = this._stack.indexOf(component);
		if (idx !== -1) this._stack.splice(idx, 1);
	}

	get openModalCount() {
		return this._stack.length;
	}

	// Close the topmost open modal (used by the global Escape handler in AppShell).
	closeTopModal() {
		const top = this._stack[this._stack.length - 1];
		if (top && typeof top.close === 'function') top.close();
	}

	// ── Openers ───────────────────────────────────────────────────────────────

	openAddFeed() {
		this.components.addFeed && this.components.addFeed.open();
	}

	openSleepTimer() {
		this.components.sleepTimer && this.components.sleepTimer.open();
	}

	openQueue() {
		this.components.queueModal && this.components.queueModal.open();
	}

	// ── Closers ───────────────────────────────────────────────────────────────

	closeAddFeed() {
		this.components.addFeed && this.components.addFeed.close();
	}

	closeSleepTimer() {
		this.components.sleepTimer && this.components.sleepTimer.close();
	}

	closeQueue() {
		this.components.queueModal && this.components.queueModal.close();
	}

	// ── Confirm dialog (Promise-based) ────────────────────────────────────────
	// The ConfirmModalComponent fires bubbling CustomEvents (confirm-confirmed /
	// confirm-cancelled); this service listens and resolves the returned promise.

	showConfirm(message, opts = {}) {
		return new Promise((resolve) => {
			const comp = this.components.confirm;
			if (!comp || typeof comp.show !== 'function') {
				resolve('cancelled');
				return;
			}
			const onConfirmed = () => { cleanup(); resolve('confirmed'); };
			const onCancel = () => { cleanup(); resolve('cancelled'); };
			const cleanup = () => {
				if (comp.el) {
					comp.el.removeEventListener('confirm-confirmed', onConfirmed);
					comp.el.removeEventListener('confirm-cancelled', onCancel);
				}
			};
			if (comp.el) {
				comp.el.addEventListener('confirm-confirmed', onConfirmed);
				comp.el.addEventListener('confirm-cancelled', onCancel);
			}
			comp.show(message, opts);
		});
	}

	// ── Status banner ─────────────────────────────────────────────────────────

	showStatus(msg) {
		this.components.status && this.components.status.show(msg);
	}

	hideStatus() {
		this.components.status && this.components.status.hide();
	}

	// ── Global reset (settings: clear all feeds + state) ──────────────────────
	// Data lives on the server, so subscriptions/positions are deleted there
	// instead of clearing browser storage. reset() does not notify, so the
	// shelf-relevant paths are re-projected onto the component views.

	async resetAll() {
		const feedIds = [...(this.state.feeds || [])];
		const positionGuids = Object.keys(this.state.playbackPositions || {});

		for (const id of feedIds) {
			try { await this.api.removeSubscriptionById(id); } catch (e) { }
		}
		for (const guid of positionGuids) {
			try { await this.api.removePosition(guid); } catch (e) { }
		}

		this.state.reset();
		this.state.pageSize = this.app.config.pageSize;
		this.state.notify('allEpisodes');
		this.state.notify('playbackPositions');
		this.state.notify('currentEpisode');
		this.state.notify('filteredEpisodes');
		this.state.notify('filterMode');
		this.state.notify('queue');
		this.state.notify('feeds');

		// Stop playback / clear engines (PlaybackService owns the audio + YT).
		if (this.app.playback && typeof this.app.playback.resetEngines === 'function') {
			this.app.playback.resetEngines();
		}

		// Legacy UI refreshes (badge counts, player buttons) — harmless while
		// Legacy DOM cache removed (R8); feature views also react via subscriptions.
		if (this.app.playback && typeof this.app.playback.syncPlaybackButtons === 'function') {
			this.app.playback.syncPlaybackButtons();
		}
		if (this.app.feeds && typeof this.app.feeds.updateFeedCountUI === 'function') {
			this.app.feeds.updateFeedCountUI();
		}
		if (this.app.queue && typeof this.app.queue.updateQueueUI === 'function') {
			this.app.queue.updateQueueUI();
		}
	}

	// No DOM wiring left; components self-register on mount.
	init() { }
}

export default ModalService;
