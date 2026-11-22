// Retire sign-ins from the former hosted companion on this origin.
try {
  for (const key of ['eddy.spotify.library.pkce', 'eddy.spotify.library.session', 'eddy.music.pkce', 'eddy.music.session']) {
    sessionStorage.removeItem(key);
  }
} catch {
  // The public guide also works with browser storage disabled.
}
const query = new URLSearchParams(location.search);
if (location.hash === '#link' || query.has('code') || query.has('error') || query.has('state')) {
  history.replaceState(history.state, '', location.pathname + '#developer-setup');
  document.getElementById('developer-setup').scrollIntoView();
}
