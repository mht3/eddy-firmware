// The public client ID for the Spotify library integration. Register this site's exact
// HTTPS /spotify/ redirect and enable access for your users before setting it.
export const spotifyClientId = '';
export const spotifyConfigured = /^[a-f0-9]{32}$/i.test(spotifyClientId);
