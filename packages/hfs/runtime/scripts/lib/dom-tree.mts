// dom-tree.mjs — walks over the draw checkers' parsed-DOM element shape ({tag, attrs, parent}).

/** The ancestors of `el`, nearest first, stopping below the '#root' sentinel. */
export interface DomElement { tag: string; attrs: Record<string, string>; parent: DomElement | null }
export const ancestorsOf = (el: DomElement): DomElement[] => { const out: DomElement[] = []; for (let p = el.parent; p && p.tag !== '#root'; p = p.parent) { out.push(p); } return out; };
