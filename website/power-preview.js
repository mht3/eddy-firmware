const delays = ['Off','5 min','10 min','15 min','30 min','45 min','60 min','90 min','2 h','6 h','12 h','24 h','48 h'];
const settingKey = 'eddy-preview-power';

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingKey));
    if (Number.isInteger(saved?.delay) && saved.delay >= 0 && saved.delay < delays.length &&
        Number.isInteger(saved?.limit) && saved.limit >= 5 && saved.limit <= 100 && saved.limit % 5 === 0) {
      return saved;
    }
  } catch { /* The preview also works with browser storage disabled. */ }
  return {delay:0, limit:100};
}

const prefs = readPreferences();
export const powerLists = {
  power: [
    ['Restart','restartOptions'],
    ['Battery info','battery'],
    ['', 'autoPower'],
    ['', 'chargeLimit'],
  ],
  restartOptions: [['Restart device','restart'], ['Firmware upgrade mode','confirmUpgrade']],
};
export const powerTitles = {
  power:'Power', restartOptions:'Restart', shutdown:'Power off?', restart:'Restart device?',
  confirmUpgrade:'Enter upgrade mode?', upgradeMode:'Upgrade mode', off:'Powered off',
};
export const powerSamples = {
  restart:['Left: Cancel','Right: Restart'], shutdown:['Left: Cancel','Right: Power off'],
  confirmUpgrade:['Left: Cancel','Right: Restart'], upgradeMode:['Preview in upgrade mode','OK to restart preview'],
  off:['OK to wake preview'],
};

function updateLabels() {
  powerLists.power[2][0] = 'Auto off  '+delays[prefs.delay];
  powerLists.power[3][0] = 'Charge limit  '+prefs.limit+'%';
}
updateLabels();

// undefined delegates to normal navigation. null consumes the input without changing pages.
export function powerAction(page, row, key) {
  if (page === 'off' || page === 'upgradeMode') return key === 'ok' ? 'home' : null;
  if (page === 'restart' || page === 'shutdown' || page === 'confirmUpgrade') {
    if (key === 'left' || key === 'back') return 'back';
    if (key !== 'right') return null;
    if (page === 'confirmUpgrade') return 'upgradeMode';
    return page === 'shutdown' ? 'off' : 'home';
  }
  if (page !== 'power') return undefined;
  const target = powerLists.power[row][1];
  if (key === 'ok' && (target === 'autoPower' || target === 'chargeLimit')) return null;
  if (key !== 'left' && key !== 'right') return undefined;
  const step = key === 'right' ? 1 : -1;
  if (target === 'autoPower') prefs.delay = Math.min(delays.length-1, Math.max(0, prefs.delay+step));
  else if (target === 'chargeLimit') prefs.limit = Math.min(100, Math.max(5, prefs.limit+5*step));
  else return null;
  updateLabels();
  try { localStorage.setItem(settingKey, JSON.stringify(prefs)); } catch { /* Keep the change in memory. */ }
  return null;
}
