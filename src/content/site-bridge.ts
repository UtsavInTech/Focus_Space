/**
 * Runs on focusspace.app and tells the page that the extension is here.
 *
 * The website talks to the extension over `externally_connectable`, which needs
 * the extension's id — and an unpacked build's id differs on every machine, so
 * it cannot be baked into the site. This content script writes it onto
 * `<html>` where the page can read it.
 *
 * It sends nothing and reads nothing else. Two attributes, then it is done.
 */
const root = document.documentElement;
root.dataset.focusspaceExtension = chrome.runtime.id;
root.dataset.focusspaceVersion = chrome.runtime.getManifest().version;

// The page may mount after this runs; an event means it never has to poll.
window.dispatchEvent(new CustomEvent('focusspace:extension', { detail: { id: chrome.runtime.id } }));
