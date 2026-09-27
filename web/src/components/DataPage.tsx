import { onLinkClick } from '../router';
import { DATA_DOES, DATA_NEVER } from '../content/data-summary';

/**
 * /data — where a visitor's data lives, in the fewest words that are still true. The full disclosure
 * (every table, every provider) is the Privacy page's job; this page links to it rather than repeating it.
 *
 * The removal notice leads because it is the one thing here that can surprise someone: FocusSpace keeps
 * their work in the browser, so removing the extension deletes it. Chrome gives an extension no chance
 * to warn anyone at the moment they remove it, so the warning has to live here, before that moment.
 *
 * Every line is checkable, like content/data-summary.ts:
 * - "deleted with the extension" → everything FocusSpace keeps is in chrome.storage.local
 *   (src/storage/storage.ts), which Chrome clears when an extension is removed.
 * - "no copy to restore from" → the server has no route that accepts spaces, notes, history, settings or
 *   channels (server/index.ts), so there is nothing on our side to bring back.
 * - "your account stays" → users, sessions, payments and entitlements are server tables (server/auth,
 *   server/billing, server/usage); removing the extension does not touch them.
 */

const LOST = [
  'Your Spaces, their topics, and the channels you chose for them',
  'Your settings and preferences, and the feed FocusSpace built around them',
  'Your watch progress and Continue watching',
  'Your saved notes, mind maps and AI chats in the Library',
];

const KEPT = [
  'Your FocusSpace account. Sign in again and it is there',
  'Your plan and payments: a paid plan is not lost, and does not need buying again',
];

export function DataPage() {
  return (
    <>
      <header className="fsw-page-head">
        <h1>Your data</h1>
        <p>FocusSpace is built so that most of it never leaves your browser.</p>
      </header>

      <section className="fsw-section fsw-data-page">
        <aside className="fsw-remove" aria-labelledby="remove-heading">
          <h2 id="remove-heading">Before you remove FocusSpace</h2>
          <p>
            Your work in FocusSpace lives in your browser, not on our servers. Removing the extension from Chrome deletes it at once
            and for good. There is no copy on our side to restore it from.
          </p>
          <div className="fsw-remove-columns">
            <div>
              <h3>Deleted with the extension</h3>
              <ul className="fsw-remove-list is-lost">
                {LOST.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Kept</h3>
              <ul className="fsw-remove-list is-kept">
                {KEPT.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="fsw-remove-note">
            If you install FocusSpace again, it starts fresh: you will set up your Spaces again, even when you sign back in to the same
            account.
          </p>
        </aside>

        {/* Two short lists, not cards: this is a page to read in seconds, not a slide. */}
        <div className="fsw-data-plain">
          <div>
            <h2>What FocusSpace does</h2>
            <ul className="fsw-remove-list is-kept">
              {DATA_DOES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>What FocusSpace never does</h2>
            <ul className="fsw-remove-list is-never">
              {DATA_NEVER.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="fsw-data-more">
          Everything we store, and why, is in the{' '}
          <a href="/privacy" onClick={onLinkClick('/privacy')}>
            privacy policy
          </a>
          .
        </p>
      </section>
    </>
  );
}
