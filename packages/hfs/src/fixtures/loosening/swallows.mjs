// The spellings of a swallowed failure that specs feed to the checkers that must refuse them. They live here, under the declared fixture folder of
// knowledge/hfs/design-truths.yaml, because the state check reads every other file of the tree and refuses these spellings there.
export const OR_TRUE = '|| true';
export const OR_COLON = '|| :';
export const SEMI_TRUE = '; true';
export const OR_ECHO = '|| echo ignored';
export const OR_EXIT_ZERO = '|| exit 0';
