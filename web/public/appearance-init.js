// Runs before styles load, and remains compatible with production's script-src 'self'.
try {
  document.documentElement.dataset.theme = localStorage.getItem('fs.site.appearance') === 'deep' ? 'dark' : 'light';
} catch {
  // Private browsing or blocked storage keeps the default Light appearance.
}
