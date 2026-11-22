// A QR on older firmware may carry a personal Client ID in the fragment.
history.replaceState(null, '', location.pathname);
try {
  const account = JSON.parse(sessionStorage.getItem('eddy.spotify.library.session'));
  if (/^eddy\.spotify\.shortcuts\.[A-Za-z0-9_-]{43}$/.test(account?.shortcuts)) {
    for (let i = 0; i < 4; i++) localStorage.removeItem(account.shortcuts + '.' + i);
  }
} catch { /* Browser storage can be disabled. */ }
try {
  for (const key of ['eddy.spotify.scan', 'eddy.spotify.library.pkce', 'eddy.spotify.library.session']) {
    sessionStorage.removeItem(key);
  }
} catch { /* Opening the companion does not require browser storage. */ }
location.replace(new URL('../app/?open=1', import.meta.url).href);
