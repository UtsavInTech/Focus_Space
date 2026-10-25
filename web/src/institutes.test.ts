import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import InstitutesPage from './components/InstitutesPage';
import { Faq } from './components/Faq';
import { CONTACT } from './content/legal';
import { INSTITUTE_CONTACT, INSTITUTES } from './content/institutes';
import { EXAMS } from '@/modes/exams';
import { FAQ } from './content/faq';
import { FEATURES } from './content/features';
import { SPACE_GALLERY } from './content/home';

describe('institute pilot invitation', () => {
  const html = renderToStaticMarkup(createElement(InstitutesPage));
  it('renders one page heading, honest availability, and no signup or payment form', () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain(INSTITUTES.availability);
    expect(html).toContain(INSTITUTES.status);
    expect(html).not.toMatch(/<form|<input|<iframe/);
    expect(html).not.toMatch(/Tathastu|₹|\$\d|testimonials/i);
  });
  it('uses the shared contact address and requested subject, without an external form service', () => {
    const target = new URL(INSTITUTE_CONTACT);
    expect(target.protocol).toBe('mailto:');
    expect(target.pathname).toBe(CONTACT);
    expect(target.searchParams.get('subject')).toBe('FocusSpace for institutes');
    expect(html).toContain(`href="${INSTITUTE_CONTACT}"`);
    expect(html).toContain('href="/"');
  });
  it('states that joining shares the number, keeps progress optional and personal Spaces private', () => {
    expect(INSTITUTES.flow[1].text).toContain('receives their name and number');
    expect(INSTITUTES.flow[1].text).toContain('separate, optional choice');
    expect(INSTITUTES.privacy).toContain('withdraw that choice at any time');
    expect(INSTITUTES.privacy).toContain('personal Spaces would never be shared');
  });
});

describe('website content wiring', () => {
  it('derives the supported goal list from the product catalog', () => {
    const answer = FAQ.find(item => item.q === 'Which exams does FocusSpace support?')!.a;
    for (const exam of EXAMS) expect(answer).toContain(exam.label);
    expect(answer).toContain('not official syllabi');
  });
  it('renders the pilot FAQ link and registers the route and title', () => {
    const html = renderToStaticMarkup(createElement(Faq));
    expect(html).toContain('href="/institutes"');
    expect(html).toContain('href="/institutes" tabindex="-1"');
    expect(html).toContain(INSTITUTES.faq);
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("path === '/institutes'");
    expect(app).toContain('INSTITUTES.title');
    expect(app).toContain('<InstitutesPage />');
  });
  it('references only real image files at both responsive sizes', () => {
    for (const feature of FEATURES) for (const shot of feature.shots) {
      for (const width of [560, 960]) expect(existsSync(new URL(`../public/journey/${shot.name}-${width}.webp`, import.meta.url))).toBe(true);
    }
    for (const space of SPACE_GALLERY) for (const width of [800, 1800]) {
      expect(existsSync(new URL(`../public/light/${space.image}-${width}.webp`, import.meta.url))).toBe(true);
    }
  });
});
