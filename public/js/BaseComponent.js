// BaseComponent.js — Podany BaseComponent
// Abstract base class for every UI component. Each component owns its own DOM
// subtree (this.el), builds it in render(), and communicates upward via
// bubbling CustomEvents. See FRONTEND_REFACTORING_COMPONENTS.md §3.1, §7, §13.
//
// Conventions enforced here:
//   * Encapsulation: a component only ever touches nodes inside its own this.el.
//   * No browser selectors on foreign trees: document.querySelector/getElementById
//     (and any query on this.app / another component) are forbidden — the ESLint
//     config already blocks document.* outside dom.js. Reference elements from the
//     own tree via stored this.el<Name> properties, captured once at build time.
//   * CustomEvent channel: component -> parent uses
//         this.el.dispatchEvent(new CustomEvent('name', { bubbles: true, detail }))
//     so children stay independent of their parents. `emit()` is a convenience
//     wrapper for exactly this.

export class BaseComponent {
    constructor(app, props = {}) {
        this.app = app;
        this.props = { ...props };
        this.state = app ? app.state : null;
        this.el = null;          // root element of this component's OWN tree
        this._mounted = false;   // guards writes after unmount()
        this._listeners = [];    // { target, type, handler } bound in mount()
        this._unsubs = [];       // functions returned by app.state.subscribe(...)
        this._timers = [];       // timer/interval ids cleared in unmount()
        this.abort = null;       // AbortController for in-flight async work
    }

    // Subclasses MUST override. Returns the root DOM element of the component.
    render() {
        throw new Error(`${this.constructor.name}.render() is not implemented`);
    }

    mount(parent) {
        if (this.el === null) {
            this.el = this.render();
        }
        if (parent && this.el.parentNode !== parent) {
            parent.appendChild(this.el);
        }
        this._mounted = true;
        this.onMount();
        return this.el;
    }

    update(newProps) {
        this.props = { ...this.props, ...(newProps || {}) };
        if (this._mounted) {
            this.onUpdate();
        }
    }

    unmount() {
        if (!this._mounted) return;
        this._mounted = false;

        this.onUnmount();

        // Detach listeners bound to this.el (delegating pattern covers lists).
        for (const { target, type, handler } of this._listeners) {
            target.removeEventListener(type, handler);
        }
        this._listeners.length = 0;

        // Resolve state subscriptions (§7.3 / §13.2).
        for (const unsub of this._unsubs) {
            if (typeof unsub === 'function') unsub();
        }
        this._unsubs.length = 0;

        // Clear timers/intervals (§13.2).
        for (const id of this._timers) {
            if (typeof id === 'number') clearTimeout(id);
            else if (id && typeof id.clear === 'function') id.clear();
        }
        this._timers.length = 0;

        // Abort in-flight async work (§10.3).
        if (this.abort && typeof this.abort.abort === 'function') this.abort.abort();
        this.abort = null;

        // Detach from the DOM.
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
    }

    // ── Lifecycle hooks (optional overrides) ───────────────────────────────

    onMount() {}
    onUpdate() {}
    onUnmount() {}

    // ── DOM helpers (own tree only) ────────────────────────────────────────

    // Bind a listener to a node in this.el and track it for unmount(). `type`
    // may be a single event name or an array of names sharing one handler; this
    // backs the bottom-up CustomEvent delegation convention where children emit
    // named events (e.g. 'play-requested') and a parent listens on its own root.
    on(target, type, handler, options) {
        if (!target || typeof target.addEventListener !== 'function') return;
        const types = Array.isArray(type) ? type : [type];
        for (const single of types) {
            target.addEventListener(single, handler, options);
            this._listeners.push({ target, type: single, handler });
        }
    }

    // Create an element via createElement (allowed; only document.* selectors
    // are forbidden). Convenience attribute setter.
    createElement(tag, attrs = {}) {
        const el = document.createElement(tag);
        for (const key of Object.keys(attrs)) {
            const value = attrs[key];
            if (key === 'class') el.className = value;
            else if (key === 'text') el.textContent = value;
            else if (key.startsWith('data-')) el.dataset[key.slice(5)] = value;
            else if (key in el) el[key] = value;
            else el.setAttribute(key, value);
        }
        return el;
    }

    // Query within this component's OWN tree only, once, at build time. Prefer
    // direct references (this.el<Name>); use these only for elements that are
    // part of the fixed template of this component. Never call on foreign trees.
    find(selector) {
        return this.el ? this.el.querySelector(selector) : null;
    }

    findAll(selector) {
        return this.el ? Array.from(this.el.querySelectorAll(selector)) : [];
    }

    // ── State subscription helper (§7.3) ───────────────────────────────────
    // Subscribe to a state path; auto-resolved in unmount(). Returns the
    // unsubscribe function (kept for callers that manage it themselves).
    subscribe(path, callback) {
        const unsub = this.state ? this.state.subscribe(path, callback) : () => {};
        this._unsubs.push(unsub);
        return unsub;
    }

    // ── Event convention (§2.D / §4) ───────────────────────────────────────
    // Communicate upward via a bubbling CustomEvent. detail carries the payload;
    // a parent listens with this.el.addEventListener('event-name', handler).
    emit(type, detail = {}) {
        if (!this.el || !this._mounted) return;
        this.el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    }

    // Timer helper that is auto-cleared in unmount() (§13.2).
    setTimeout(fn, delay) {
        const id = setTimeout(fn, delay);
        this._timers.push(id);
        return id;
    }
}

export default BaseComponent;
