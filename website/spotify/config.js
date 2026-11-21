// The public client ID for the Spotify library integration. Register this site's exact
// HTTPS /spotify/ redirect and enable access for your users before setting it.
export const spotifyClientId = '3d43cab323b0458087e1027d507cdb67';
export const spotifyConfigured = /^[a-f0-9]{32}$/i.test(spotifyClientId);
