// dom-tree.mjs — walks over the draw checkers' parsed-DOM element shape ({tag, attrs, parent}).
export const ancestorsOf = (el) => { const out = []; for (let p = el.parent; p && p.tag !== '#root'; p = p.parent) {
    out.push(p);
} return out; };
