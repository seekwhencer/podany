export const dc = (tag, props = null) => {

    const el = document.createElement(tag);

    if (props === null)
        return el;

    Object.keys(props).forEach(prop => {
        if (prop !== 'data') {
            el[prop] = props[prop]
        } else {
            el.dataset[prop] = props[prop];
        }
    });

    return el;
}

export const g = (id) => document.getElementById(id);
export const q = (el, sel) => el.querySelector(sel);
export const qa = (el, sel) => el.querySelectorAll(sel);