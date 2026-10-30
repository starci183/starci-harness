/** Read the first numeric capture of a matching recognizer; unmatched values have no number. */
export function numericMatch(value, pattern) {
    const match = pattern.exec(String(value ?? ''));
    return match ? Number(match[1]) : null;
}
