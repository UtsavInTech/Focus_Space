import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

const render = (text: string, onSeek?: (sec: number) => void, maxSec?: number | null) => renderToStaticMarkup(createElement(RichText, { text, onSeek, maxSec }));

/** Every cited-time button in the rendered tree, found without a DOM. */
function citeButtons(node: ReactNode): ReactElement<{ className?: string; onClick?: () => void; children?: ReactNode }>[] {
  const found: ReactElement<{ className?: string; onClick?: () => void; children?: ReactNode }>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ className?: string; children?: ReactNode }>(n)) return;
    if (n.type === 'button' && n.props.className === 'fs-ts-cite') found.push(n);
    walk(n.props.children);
  };
  walk(node);
  return found;
}

describe('RichText cited times', () => {
  it('stays plain text without onSeek — every existing screen renders exactly as before', () => {
    const html = render('He explains it at [42:18], then again at [1:02:05–1:03:00].');
    expect(html).not.toContain('<button');
    expect(html).toContain('[42:18]');
    expect(html).toContain('[1:02:05–1:03:00]');
  });

  it('turns [mm:ss] and [h:mm:ss–h:mm:ss] into seek buttons when onSeek is given', () => {
    const html = render('He explains it at [42:18], then again at [1:02:05–1:03:00].', () => undefined);
    expect(html.match(/<button[^>]*class="fs-ts-cite"/g)).toHaveLength(2);
    expect(html).toContain('>42:18</button>');
    expect(html).toContain('>1:02:05–1:03:00</button>');
  });

  it('seeks to the start of the cited time', () => {
    const seeks: number[] = [];
    const tree = RichText({ text: 'See [42:18] and [1:02:05–1:03:00].', onSeek: (sec) => seeks.push(sec) });
    citeButtons(tree).forEach((b) => b.props.onClick?.());
    expect(seeks).toEqual([2538, 3725]);
  });

  it('leaves ordinary brackets, bare times, impossible clocks and times past the end alone', () => {
    const html = render('Point [1], a [note], at 42:18 bare, [12:75] invalid, [5:00–4:00] backwards, [2:00:00] past the end.', () => undefined, 3600);
    expect(html).not.toContain('<button');
  });

  it('never links times inside code, and keeps bold and code rendering', () => {
    const html = render('**Heaps** at [3:10] use `heapify` —\n\n```\nlog("[3:10]")\n```', () => undefined);
    expect(html).toContain('<strong>Heaps</strong>');
    expect(html).toContain('<code>heapify</code>');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('log(&quot;[3:10]&quot;)');
  });
});

describe('RichText lists', () => {
  it('renders "- " and "• " lines as a bulleted list and "1. " lines as a numbered one', () => {
    const html = render('Two ways:\n- chaining\n• open addressing\n\n1. Split the list\n2. Merge the halves');
    expect(html).toContain('<p>Two ways:</p><ul><li>chaining</li><li>open addressing</li></ul>');
    expect(html).toContain('<ol start="1"><li>Split the list</li><li>Merge the halves</li></ol>');
  });

  it('keeps an indented line with the item above, and keeps links and bold inside items', () => {
    const html = render('1. **Heap** at [3:10]\n   built bottom-up', () => undefined);
    expect(html).toContain('<li><strong>Heap</strong> at <button');
    expect(html).toContain('built bottom-up</li>');
  });

  it('leaves ordinary paragraphs as they were', () => {
    expect(render('Binary search halves the range.\nThen it repeats.')).toBe('<div class="fs-answer-text"><p>Binary search halves the range.\nThen it repeats.</p></div>');
  });
});
