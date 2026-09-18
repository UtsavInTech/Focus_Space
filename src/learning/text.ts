/** Text helpers shared by the classifier and UI search. */

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[|•·–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a matcher for a keyword that respects word boundaries, including
 * keywords with symbols such as "c++", "next.js" or "ci/cd".
 * Tolerates a plural "s" on each word and treats spaces/hyphens as interchangeable.
 */
export function keywordPattern(keyword: string): RegExp | null {
  const k = normalizeText(keyword);
  if (!k) return null;
  // Every word may be plural ("stream api" matches "streams api"); spaces and hyphens are interchangeable.
  const body = k
    .split(/[\s-]+/)
    .map((word) => escapeRegExp(word) + (/[a-z]$/.test(word) && !word.endsWith('s') ? 's?' : ''))
    .join('[\\s-]?');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9+#])`, 'i');
}

export function slugify(input: string): string {
  return (
    normalizeText(input)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = slugify(prefix);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Parse a comma/newline separated list typed by the user. */
export function parseList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (v && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}
