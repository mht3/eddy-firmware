// The QR supplies a public app identifier. Only this tab keeps the sign-in context.
import {authorize, callback, linked} from './spotify.js';

const scanKey = 'eddy.spotify.scan';
const connectionUrl = new URL('connect/', import.meta.url).href;
const validId = id => typeof id === 'string' && id.length === 32 && /^[a-f0-9]+$/i.test(id);

export function scanSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(scanKey));
    return validId(value?.id) ? value : null;
  } catch { return null; }
}

export async function scanQr() {
  const id = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  if (!validId(id)) throw new Error('Open Apps → Spotify on your Flipper and scan its sign-in QR code.');
  sessionStorage.setItem(scanKey, JSON.stringify({id}));
  if (linked(id)) location.replace(connectionUrl);
  else await authorize(id);
}

export async function finishScan() {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error') && !query.has('state')) return;
  history.replaceState(null, '', location.pathname);
  // The native app owns its PKCE verifier and validates the state before exchanging this one-use code.
  const state = query.get('state') ?? '';
  if (query.getAll('state').length === 1 && /^eddy-ios-[A-Za-z0-9_-]{32,128}$/.test(state)) {
    const codes = query.getAll('code'), errors = query.getAll('error');
    if (codes.length + errors.length !== 1 || !(codes[0] || errors[0])) {
      throw new Error('Incomplete iPhone sign-in. Return to Eddy and try again.');
    }
    const callback = new URL('eddyspotify://callback');
    callback.searchParams.set('state', state);
    callback.searchParams.set(codes.length ? 'code' : 'error', (codes[0] || errors[0]));
    location.replace(callback.href);
    return;
  }
  const session = scanSession();
  if (!session) throw new Error('This tab has no pending Spotify sign-in. Scan the QR on your Flipper again and finish in the same browser.');
  let message;
  try { await callback(session.id, query); }
  catch (error) { message = error.message; }
  sessionStorage.setItem(scanKey, JSON.stringify({id:session.id, message}));
  location.replace(connectionUrl);
}

export function takeNotice(session) {
  sessionStorage.setItem(scanKey, JSON.stringify({id:session.id}));
  return session.message;
}
