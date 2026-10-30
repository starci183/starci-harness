// The refusal every `starci app db` verb module throws; dbFailure (db-baseline-verb.mjs) prints its message, any other error is withheld.
export class DbVerbError extends Error {}
