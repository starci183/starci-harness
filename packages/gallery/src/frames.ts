/** The file a canvas frame is served as, `<area>__<screen>__<width>.html` (load.ts writes it, the viewer asks for it). */
export const frameFile = (id: string, width: string): string => `${id.replace("/", "__")}__${width}.html`
