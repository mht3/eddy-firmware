// An ordinary visit shows the install guide. A Flipper scan can also open the installed app.
// Leave the guide in browser history so returning from Eddy or TestFlight always lands here.
const fromFlipper = new URLSearchParams(location.search).get('open') === '1';
if (fromFlipper) {
  history.replaceState(null, '', location.pathname + '#iphone');
  document.getElementById('iphone').scrollIntoView();
  if (/iPhone|iPod/.test(navigator.userAgent)) {
    location.assign('eddyspotify://setup');
  }
}
