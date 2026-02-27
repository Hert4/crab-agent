// Set initial theme mode based on system preference
(function () {
  const stored = localStorage.getItem('crab-theme');
  if (stored) {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
})();
