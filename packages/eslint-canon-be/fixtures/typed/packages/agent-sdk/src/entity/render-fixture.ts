/** A fixture DDL renderer: it only builds and returns text. */
export const renderCreateTable = (name: string): string => `CREATE TABLE ${name} (id uuid PRIMARY KEY)`
