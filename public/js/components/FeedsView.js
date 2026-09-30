// FeedsView.js — Podany FeedsView (Feature Component / container)
// Small container for the /feeds route that hosts the FeedsGridComponent. See spec
// §4, §5.

import { BaseComponent } from '../BaseComponent.js';
import FeedsGridComponent from './FeedsGridComponent.js';

export class FeedsView extends BaseComponent {
    constructor(app) {
        super(app, {});
        this.grid = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'feeds-view' });
        return this.el;
    }

    mount(parent) {
        if (this.el === null) this.el = this.render();
        if (parent && this.el.parentNode !== parent) parent.appendChild(this.el);
        this._mounted = true;

        this.grid = new FeedsGridComponent(this.app);
        this.grid.mount(this.el);

        this.onMount();
        return this.el;
    }

    unmount() {
        if (this.grid) this.grid.unmount();
        super.unmount();
    }
}

export default FeedsView;
