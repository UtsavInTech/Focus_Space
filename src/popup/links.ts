/**
 * Where the popup's links go — as data, because the distinction they encode is a product rule and was
 * quietly broken once already.
 *
 * FocusSpace has two surfaces and they are not interchangeable:
 *
 * - The **extension dashboard** (dashboard.html, hash routes) is the learner's own workspace: their
 *   Spaces, what they were watching, their notes and mind maps, their AI chats, their account state.
 *   "FocusSpace Home" means *this*, and nothing else.
 * - The **public website** (focusspace.xyz) is product introduction, features, pricing, FAQ and
 *   acquisition. It knows nothing about the learner's Spaces — it cannot, they never leave the browser.
 *
 * "FocusSpace Home" in the popup used to open the public website, which dropped someone who wanted
 * their own workspace onto a marketing page. Only reaching for the website for what the website
 * actually owns — pricing and billing — keeps the two apart.
 */

export type PopupSurface = 'dashboard' | 'site' | 'youtube';

export interface PopupLink {
  id: string;
  label: string;
  surface: PopupSurface;
  /** A dashboard hash route, a website path, or a YouTube URL, depending on `surface`. */
  target: string;
}

/** The secondary links along the bottom of the popup, in order. */
export const POPUP_LINKS: PopupLink[] = [
  { id: 'spaces', label: 'Manage spaces', surface: 'dashboard', target: '/modes' },
  { id: 'subscriptions', label: 'Subscribed channels', surface: 'dashboard', target: '/subscriptions' },
  { id: 'home', label: 'FocusSpace Home', surface: 'dashboard', target: '/' },
];

/** The learner's own workspace. Anything described as "FocusSpace Home" resolves here. */
export const DASHBOARD_HOME = '/';
