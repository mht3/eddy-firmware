const phones = ["iphone", "android"];
const platforms = document.getElementById("platforms");
function choose(phone) {
  for (const name of phones) {
    document.getElementById(name).hidden = name !== phone;
    document.getElementById("choose-" + name).setAttribute("aria-pressed", String(name === phone));
  }
}
for (const phone of phones) {
  document.getElementById("choose-" + phone).addEventListener("click", () => choose(phone));
}
choose(/Android/i.test(navigator.userAgent) ? "android" : "iphone");
platforms.hidden = false;

if (new URLSearchParams(location.search).has("state")) choose("android");
const {spotifyClientId} = await import("./config.js");
if (/^[0-9a-f]{32}$/i.test(spotifyClientId) && navigator.bluetooth && window.isSecureContext) {
  const {startBridge} = await import("./bridge.js");
  startBridge(spotifyClientId);
}
