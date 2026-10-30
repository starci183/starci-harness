// order.mts - the one string order of the cache: by UTF-16 code unit, so every host sorts one record set alike.
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
