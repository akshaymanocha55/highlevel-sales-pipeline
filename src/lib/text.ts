const num = new Intl.NumberFormat('en-IN');

export const count = (n: number) => num.format(n);

/** "1 deal", "2,500 deals" */
export const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;
