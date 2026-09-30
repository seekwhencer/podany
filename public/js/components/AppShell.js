// AppShell.js — Podany AppShell (Layout Component)
// Central container that holds Header (top), MainContent (center, router-driven)
// and PlayerBar (persistent bottom). It reacts to the router's 'routechange'
// CustomEvent and swaps the MainContent view, unmounting the previous view first.
// See FRONTEND_REFACTORING_COMPONENTS.md §2, §6, §9.
//
// Layout note: the component shell owns the .app-container + .main-content
// structure (§6.2) and builds it on the #app mount root. Header (R1), PlayerBar
// (R6) and Dock (R2) are active children; all semantic static HTML is gone.
// The router-driven view area lives inside the shell-owned .main-content so
// feature views keep their mount targets. Dock visibility is CSS-driven by
// body[data-active-view].

import { BaseComponent } from '../BaseComponent.js';
import HeaderComponent from './HeaderComponent.js';
import PlayerBarComponent from './PlayerBarComponent.js';
import DockComponent from './DockComponent.js';
import AuthFlowComponent from './AuthFlowComponent.js';
import LiveConnectionComponent from './LiveConnectionComponent.js';
import ShowNotesComponent from './ShowNotesComponent.js';
import AddFeedComponent from './AddFeedComponent.js';
import SleepTimerComponent from './SleepTimerComponent.js';
import ConfirmModalComponent from './ConfirmModalComponent.js';
import QueueModalComponent from './QueueModalComponent.js';
import StatusComponent from './StatusComponent.js';

export class AppShell extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.router = app ? app.router : null;
        this.header = null;
        this.playerBar = null;
        this.dock = null;
        this.authFlow = null;
        this.liveConnection = null;
        this.showNotes = null;
        // Modal chrome (R5): add-feed, sleep-timer, confirm, queue and status
        // banners. Each owns its own DOM and registers with app.modal on mount.
        this.addFeed = null;
        this.sleepTimer = null;
        this.confirmModal = null;
        this.queueModal = null;
        this.status = null;
        this.viewArea = null;
        this._children = [];      // layout children unmounted in onUnmount()
        this._currentView = null;  // currently mounted view (component or stub)
        this._routeHandler = null;
        this.views = {};           // route name -> factory(app, {route,params}) -> view (Phase 5)
    }

    // Compose the three regions. AppShell owns the .app-container + .main-content
    // structure (§6.2) and builds it here; the static HTML only provides the #app
    // mount root. Header + PlayerBar + Dock + modal chrome are children of
    // .app-container; the router-driven view area lives inside .main-content.
    mount(parent) {
        if (this._mounted) return this.viewArea;

        this.el = this.createElement('div', { class: 'app-container' });

        this.header = new HeaderComponent(this.app);
        this.header.mount();
        this._children.push(this.header);
        this.el.appendChild(this.header.el);

        this.playerBar = new PlayerBarComponent(this.app);
        this.playerBar.mount();
        this._children.push(this.playerBar);
        this.el.appendChild(this.playerBar.el);

        // Bottom-action dock (R2): filter/sort/refresh/search + live counts. It is
        // shell chrome like Header/PlayerBar, mounted once and kept across view
        // swaps; its visibility is CSS-driven by body[data-active-view] (timeline).
        this.dock = new DockComponent(this.app);
        this.dock.mount();
        this._children.push(this.dock);
        this.el.appendChild(this.dock.el);

        // Auth flow: self-contained modal overlay driven by app.state.authModalOpen.
        this.authFlow = new AuthFlowComponent(this.app);
        this.authFlow.mount();
        this._children.push(this.authFlow);
        this.el.appendChild(this.authFlow.el);

        // Live connection / download status (small floating status element).
        this.liveConnection = new LiveConnectionComponent(this.app);
        this.liveConnection.mount();
        this._children.push(this.liveConnection);
        this.el.appendChild(this.liveConnection.el);

        // Show-notes overlay (opened on demand from episode cards / player).
        this.showNotes = new ShowNotesComponent(this.app);
        this.showNotes.mount();
        this._children.push(this.showNotes);
        this.el.appendChild(this.showNotes.el);
        // Expose to services so TimelineService.openShowNotes() reaches the component.
        this.app.showNotes = this.showNotes;

        // Modal chrome (R5): mount once, persist across view swaps. Each component
        // is hidden by default (overlay .hidden) and opened on demand via
        // app.modal.open*. They register themselves with app.modal on mount.
        this.addFeed = new AddFeedComponent(this.app);
        this.addFeed.mount();
        this._children.push(this.addFeed);
        this.el.appendChild(this.addFeed.el);

        this.sleepTimer = new SleepTimerComponent(this.app);
        this.sleepTimer.mount();
        this._children.push(this.sleepTimer);
        this.el.appendChild(this.sleepTimer.el);

        this.confirmModal = new ConfirmModalComponent(this.app);
        this.confirmModal.mount();
        this._children.push(this.confirmModal);
        this.el.appendChild(this.confirmModal.el);

        this.queueModal = new QueueModalComponent(this.app);
        this.queueModal.mount();
        this._children.push(this.queueModal);
        this.el.appendChild(this.queueModal.el);

        this.status = new StatusComponent(this.app);
        this.status.mount();
        this._children.push(this.status);
        this.el.appendChild(this.status.el);

        const mainContent = this.createElement('div', { class: 'main-content' });
        this.el.appendChild(mainContent);
        this.viewArea = this.createElement('div', { class: 'app-shell-view' });
        mainContent.appendChild(this.viewArea);

        (parent || document.body).appendChild(this.el);

        this._mounted = true;
        this.onMount();
        return this.viewArea;
    }

    onMount() {
        this._routeHandler = (event) => {
            const detail = (event && event.detail) || {};
            this._swapView(detail.route, detail.params);
        };
        // The router dispatches 'routechange' on document (it has no DOM of its
        // own), so the listener must live there. Bound via on() so unmount()
        // removes it (§13.2).
        this.on(document, 'routechange', this._routeHandler);

        // Global Escape closes the topmost open modal (R5). The modal stack lives
        // in ModalService; this listener only delegates and is removed in unmount().
        this._escapeHandler = (e) => {
            if (e.key === 'Escape' && this.app.modal && this.app.modal.openModalCount > 0) {
                this.app.modal.closeTopModal();
            }
        };
        this.on(document, 'keydown', this._escapeHandler);

        // AppShell is the layout root and the only component permitted to touch
        // document.body. It projects the global playback/body-class state
        // (has-active-episode / has-mini-player / has-full-player) that the CSS
        // uses for the app padding, the player and the dock. PlaybackService stays
        // DOM-free; the PlayerBar projects its own visibility from app.state.
        this._unsubs.push(this.subscribe('currentEpisode', () => this._applyBodyClasses()));
        this._unsubs.push(this.subscribe('playerCollapsed', () => this._applyBodyClasses()));
        this._applyBodyClasses();

        this._seedInitialView();
    }

    // Global body-class projection (§6 / §13). Kept here because document.body is
    // the app root owned by this shell; services and feature views never touch it.
    _applyBodyClasses() {
        if (typeof document === 'undefined' || !document.body) return;
        const hasEpisode = !!(this.state && this.state.currentEpisode);
        const collapsed = this.state && this.state.playerCollapsed === true;
        document.body.classList.toggle('has-active-episode', hasEpisode);
        if (collapsed) {
            document.body.classList.add('has-mini-player');
            document.body.classList.remove('has-full-player');
        } else {
            document.body.classList.remove('has-mini-player');
            document.body.classList.add('has-full-player');
        }
    }

    // View-scoped chrome projection: mark the active routed view so CSS can show
    // / hide per-view shell elements (e.g. the timeline filter/sort dock).
    _applyViewClass(route) {
        if (typeof document === 'undefined' || !document.body) return;
        const name = route && route.name ? route.name : '';
        document.body.dataset.activeView = name;
    }

    // Swap the MainContent view: unmount the previous view, mount the next.
    _swapView(route, params) {
        if (this._currentView && typeof this._currentView.unmount === 'function') {
            this._currentView.unmount();
            this._currentView = null;
        }
        if (!this.viewArea || !this._mounted) return;

        // Couple view-scoped shell chrome (the filter/sort dock) to the active
        // routed view. Kept in the shell because it owns document.body.
        this._applyViewClass(route);

        // Clear any previous view's DOM (§13.1): unmount() removes the node for
        // real components; force-clear for the lightweight Phase 2 stub.
        while (this.viewArea.firstChild) this.viewArea.removeChild(this.viewArea.firstChild);

        const factory = route && this.views[route.name] ? this.views[route.name] : null;
        if (factory) {
            const view = factory(this.app, { route, params });
            this._currentView = view;
            if (view && typeof view.mount === 'function') {
                view.mount(this.viewArea);
            } else if (view && view.el) {
                this.viewArea.appendChild(view.el);
            }
            return;
        }

        // Phase 2 placeholder: the swap mechanism is in place; Phase 5 registers
        // real view factories via registerView().
        this.viewArea.textContent = '';
        const marker = this.createElement('div', { class: 'app-shell-view-marker' });
        marker.textContent = route ? `— ${route.name} (view placeholder — Phase 5) —` : '— no route —';
        this.viewArea.appendChild(marker);
        this._currentView = { unmount: () => {} };
    }

    _seedInitialView() {
        const cur = this.router && this.router.current ? this.router.current : null;
        this._swapView(cur && cur.route, cur && cur.params);
    }

    // Phase 5 hook: register a view factory by route name. Re-renders if the
    // registered view is currently active.
    registerView(name, factory) {
        this.views[name] = factory;
        const cur = this.router && this.router.current ? this.router.current : null;
        if (cur && cur.route && cur.route.name === name) {
            this._swapView(cur.route, cur.params);
        }
    }

    onUnmount() {
        for (const child of this._children) {
            if (child && typeof child.unmount === 'function') child.unmount();
        }
        this._children.length = 0;
        if (this._currentView && typeof this._currentView.unmount === 'function') {
            this._currentView.unmount();
        }
        this._currentView = null;
        this._routeHandler = null;

        // Detach the container this shell built (§6.2).
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
    }
}

export default AppShell;
