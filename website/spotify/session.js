// The iPhone owns the PKCE verifier and exchanges the one-use code after validating state.
export function finishSignIn() {
  const query = new URLSearchParams(location.search);
  if (!['code', 'error', 'state'].some(key => query.has(key))) return;

  history.replaceState(null, '', location.pathname);
  const states = query.getAll('state');
  if (states.length !== 1 || !/^eddy-ios-[A-Za-z0-9_-]{32,128}$/.test(states[0])) {
    throw new Error('Open Eddy on your iPhone and tap Log in to Spotify to start a new sign-in.');
  }
  const codes = query.getAll('code');
  const errors = query.getAll('error');
  if (codes.length + errors.length !== 1 || !(codes[0] || errors[0])) {
    throw new Error('Incomplete iPhone sign-in. Return to Eddy and try again.');
  }
  const callback = new URL('eddyspotify://callback');
  callback.searchParams.set('state', states[0]);
  callback.searchParams.set(codes.length ? 'code' : 'error', codes[0] || errors[0]);
  location.replace(callback.href);
}
