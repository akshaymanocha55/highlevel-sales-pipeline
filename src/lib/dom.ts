export const GRID_ID = 'deal-grid';
export const SEARCH_ID = 'search';

export const focusGrid = () => document.getElementById(GRID_ID)?.focus();
export const focusSearch = () => document.getElementById(SEARCH_ID)?.focus();

/** Join class names, skipping falsy ones. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
