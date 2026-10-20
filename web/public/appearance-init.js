// Runs before styles load, and remains compatible with production's script-src 'self'.
try {
  if (localStorage.getItem('fs.site.appearance') === 'light') {
    document.documentElement.dataset.theme = 'light';
  }
} catch {
  // Private browsing or blocked storage keeps the default Deep appearance.
}
