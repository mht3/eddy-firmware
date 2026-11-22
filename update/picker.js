import {catalog, getAppOrder, getSelectedApps, setAppOrder, setAppSelected, setSelectedApps} from '../app-catalog.js';
import {drawLauncher, layoutApps, launcherArt} from '../launcher.js';
import {drawBattery} from '../home-screen.js';
import {communityApps, communityAliases, communityAvailable, getCommunitySelection, selectCommunity, labAlias,
  catalogCompatibility, setImportBusy, importInProgress, rememberLabApp, communityLimit, previewId, drawLabIcon} from '../community-apps.js';
import {fetchLabApp, LabFileRequired} from './flipper-lab.js';
import {appArranger} from './arrange.js';

const form = document.getElementById('app-picker');
const screen = document.getElementById('selected-screen');
const menuPreview = document.getElementById('try-app-menu');
const count = document.getElementById('app-count');
const cards = new Map();
let lastAdded;
const renderOrder = appArranger(id => { lastAdded = id; }, makeIcon);

function makeIcon(app,community) {
  const icon = document.createElement('span');
  icon.className = 'app-icon';
  icon.setAttribute('aria-hidden','true');
  if (community) {
    icon.classList.add('community-icon');
    if (app.iconHex) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 10;
      drawLabIcon(canvas.getContext('2d'),app.iconHex,0,0);
      icon.append(canvas);
    } else icon.textContent = app.glyph;
  }
  return icon;
}

function makeCard(app,community=false) {
  const card = document.createElement('li');
  card.className = 'app-card';
  card.dataset.id = app.id;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'app-toggle';
  toggle.setAttribute('aria-label', 'Include ' + app.name);
  const descriptionId = 'desc-' + (community ? previewId(app) : app.id);
  toggle.setAttribute('aria-describedby', descriptionId);
  const mark = document.createElement('span');
  mark.className = 'toggle-mark';
  mark.setAttribute('aria-hidden','true');
  const icon = makeIcon(app,community);
  const name = document.createElement('span');
  name.className = 'app-name';
  name.textContent = app.name;
  toggle.append(mark,icon,name);

  const description = document.createElement('p');
  description.id = descriptionId;
  description.className = 'app-description';
  description.textContent = app.description;
  card.title = app.description;

  const preview = document.createElement('a');
  preview.className = 'app-preview';
  preview.id = 'try-' + (community ? 'community-' : '') + app.id;
  preview.textContent = community?'View in Flipper Lab':'Try in emulator';
  preview.setAttribute('aria-label',community?'View '+app.name+' in Flipper Lab':'Try ' + app.name + ' in emulator');
  const excluded = document.createElement('button');
  excluded.type = 'button';
  excluded.className = 'excluded';
  excluded.textContent = 'Add to build';
  excluded.setAttribute('aria-label','Add ' + app.name + ' to build');
  excluded.addEventListener('click', () => {
    toggle.focus();
    toggle.click();
  });
  card.append(toggle,description,preview,excluded);
  if (app.sourceUrl) {
    const source = document.createElement('a');
    source.className = 'app-preview';
    source.textContent = 'Source code';
    source.href = app.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    card.append(source);
  }
  if (!community && app.id === 'spotify') {
    const setup = document.createElement('a');
    setup.className = 'app-preview';
    setup.href = '../spotify/';
    setup.textContent = 'Spotify setup';
    card.append(setup);
  }
  toggle.addEventListener('click', () => {
    const choices=new Set(community?getCommunitySelection():getSelectedApps());
    const enable = !choices.has(app.id);
    if (enable) lastAdded = community ? previewId(app) : app.id;
    if (community) {
      if (enable && choices.size >= communityLimit) {
        importStatus.textContent = 'Select up to '+communityLimit+' community apps in one build.';
        return;
      }
      if (enable) choices.add(app.id);
      else choices.delete(app.id);
      selectCommunity([...choices]);
    } else setAppSelected(app.id, enable);
  });
  cards.set(community ? 'community:'+app.id : app.id,{id:app.id,card,toggle,mark,preview,excluded,community,record:app});
  return card;
}

function previewUrl(selected, id) {
  const url = new URL('../', location.href);
  url.searchParams.set('apps',[...selected].join(','));
  url.searchParams.set('order',getAppOrder().join(','));
  url.searchParams.set('community',getCommunitySelection().join(','));
  if (id) url.searchParams.set('app',id);
  url.hash = 'home-screen';
  return url.href;
}

function drawSelected() {
  const ctx = screen.getContext('2d');
  if (!ctx) return;
  const selected = getSelectedApps();
  const communityIds = getCommunitySelection();
  const items = [
    ...catalog.filter(app => selected.has(app.id)).map(app => [app.name, app.id]),
    ...communityApps.filter(app => communityIds.includes(app.id)).map(app => [app.name, previewId(app)]),
  ];
  const rows = layoutApps(items);
  ctx.setTransform(screen.width / 128,0,0,screen.height / 64,0,0);
  ctx.clearRect(0,0,128,64);
  ctx.fillStyle = ctx.strokeStyle = '#432a14';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;
  const position = Math.max(0, rows.findIndex(([,id]) => id === lastAdded));
  drawLauncher(ctx, 'apps', position, rows);
  drawBattery(ctx);
}

function sync() {
  if (form.disabled) return;
  const selected = getSelectedApps();
  const communityIds=getCommunitySelection();
  for (const app of communityApps) {
    const old = cards.get('community:'+app.id);
    if (!old || old.record.sha256 !== app.sha256) {
      old?.card.remove();
      form.querySelector('#community-apps').append(makeCard(app,true));
    }
  }
  for (const {id,card,toggle,mark,preview,excluded,community} of cards.values()) {
    const included = community?communityIds.includes(id):selected.has(id);
    card.hidden=community && !communityAvailable(id);
    card.classList.toggle('included',included);
    toggle.setAttribute('aria-pressed',String(included));
    mark.textContent = included ? '×' : '+';
    preview.hidden = !included;
    excluded.hidden = included;
    if(community) {
      preview.href='https://lab.flipper.net/apps/'+id; preview.target='_blank'; preview.rel='noopener noreferrer';
    } else if (included) preview.href = previewUrl(selected,id);
    else preview.removeAttribute('href');
  }
  renderOrder(selected,communityIds);
  const total=selected.size+communityIds.length;
  count.textContent = total + (total === 1 ? ' app selected' : ' apps selected');
  menuPreview.href = previewUrl(selected);
  drawSelected();
}

// The preview return link also carries the choices for browsers that block storage.
const returnUrl = new URL(location.href);
let missingCommunity = [];
if(returnUrl.searchParams.has('community')) {
  const aliases = communityAliases(returnUrl.searchParams.get('community').split(','));
  missingCommunity = aliases.filter(id => !communityApps.some(app => app.id === id));
  selectCommunity(aliases);
  returnUrl.searchParams.delete('community');
}
if (returnUrl.searchParams.has('order')) {
  setAppOrder(returnUrl.searchParams.get('order').split(','));
  returnUrl.searchParams.delete('order');
}
if (returnUrl.searchParams.has('apps')) {
  const ids = returnUrl.searchParams.get('apps').split(',').filter(Boolean);
  if (ids.every(id => catalog.some(app => app.id === id))) setSelectedApps(ids);
  returnUrl.searchParams.delete('apps');
}
if (returnUrl.href !== location.href) history.replaceState(history.state, '', returnUrl);
new MutationObserver(() => {
  form.inert = form.disabled;
  menuPreview.inert = form.disabled;
  if (!form.disabled) sync();
}).observe(form,{attributes:true,attributeFilter:['disabled']});
for (const app of catalog) {
  form.querySelector(app.core ? '#core-apps' : '#extra-apps').append(makeCard(app));
}
const importer=document.querySelector('#community-import');
const appLink=document.querySelector('#lab-app-link');
const importStatus=document.querySelector('#community-status');
const fileStep = document.querySelector('#lab-file-step');
const fileInput = document.querySelector('#lab-file');
const addButton = importer.querySelector('button');
let awaitingFile;
if (missingCommunity.length) {
  appLink.value = 'https://lab.flipper.net/apps/' + missingCommunity[0];
  importStatus.textContent = missingCommunity.length === 1 ?
    'Add ' + missingCommunity[0] + ' from Flipper Lab to verify it for this build.' :
    'Add the ' + missingCommunity.length + ' community apps from your shared layout to verify their packages in this browser.';
}
function clearFileStep() {
  awaitingFile = null;
  fileStep.hidden = true;
  fileInput.value = '';
}
function finishAdding(app) {
  const selected = getCommunitySelection();
  if (!selected.includes(app.id) && selected.length >= communityLimit) {
    throw Error('Select up to '+communityLimit+' community apps in one build.');
  }
  lastAdded = previewId(app);
  importStatus.textContent = selected.includes(app.id) ? app.name+' is already selected.' : app.name+' added to your build.';
  selectCommunity([...selected,app.id]);
  appLink.value = '';
  clearFileStep();
}
async function addLabApp(id,file) {
  if (importInProgress() || form.disabled) return;
  const known = communityApps.find(app => app.id === id);
  setImportBusy(true);
  addButton.disabled = appLink.disabled = fileInput.disabled = true;
  try {
    if (known && !known.imported && communityAvailable(id)) {
      finishAdding(known);
      return;
    }
    const compatibility = catalogCompatibility();
    if (!compatibility) throw Error('This release cannot import new apps. Refresh for the latest Eddy build.');
    importStatus.textContent = file ? 'Checking the selected file…' : 'Checking the Flipper Lab package…';
    const result = await fetchLabApp(id,compatibility,file);
    const app = await rememberLabApp(result);
    finishAdding(app);
  } catch (error) {
    if (error instanceof LabFileRequired) {
      awaitingFile = id;
      document.querySelector('#lab-download').href = error.downloadUrl;
      fileStep.hidden = false;
      importStatus.textContent = error.message;
    } else importStatus.textContent = error.message;
  } finally {
    addButton.disabled = appLink.disabled = fileInput.disabled = false;
    setImportBusy(false);
  }
}
importer.addEventListener('submit',event => {
  event.preventDefault();
  clearFileStep();
  const id = labAlias(appLink.value);
  if (!id) {
    importStatus.textContent = 'Paste the link from a Flipper Lab app page.';
    return;
  }
  addLabApp(id);
});
appLink.addEventListener('input',() => { clearFileStep(); importStatus.textContent = ''; });
fileInput.addEventListener('change',() => {
  const file = fileInput.files[0];
  if (file && awaitingFile) addLabApp(awaitingFile,file);
  fileInput.value = '';
});
window.addEventListener('eddy-apps-changed',sync);
launcherArt.addEventListener('load', drawSelected);
window.addEventListener('pageshow',sync);
sync();
