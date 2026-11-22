import {catalog, getAppOrder, getSelectedApps, setAppOrder, setAppSelected, setSelectedApps} from '../app-catalog.js';
import {drawLauncher, layoutApps, launcherArt} from '../launcher.js';
import {drawBattery} from '../home-screen.js';
import {communityApps,communityAvailable,getCommunitySelection,selectCommunity,labAlias} from '../community-apps.js';
import {appArranger} from './arrange.js';

const form = document.getElementById('app-picker');
const screen = document.getElementById('selected-screen');
const menuPreview = document.getElementById('try-app-menu');
const count = document.getElementById('app-count');
const cards = new Map();
let lastAdded;
const renderOrder = appArranger(id => { lastAdded = id; });

function makeCard(app,community=false) {
  const card = document.createElement('li');
  card.className = 'app-card';
  card.dataset.id = app.id;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'app-toggle';
  toggle.setAttribute('aria-label', 'Include ' + app.name);
  toggle.setAttribute('aria-describedby', 'desc-' + app.id);
  const mark = document.createElement('span');
  mark.className = 'toggle-mark';
  mark.setAttribute('aria-hidden','true');
  const icon = document.createElement('span');
  icon.className = 'app-icon';
  icon.setAttribute('aria-hidden','true');
  if (community) {
    icon.classList.add('community-icon');
    icon.textContent = app.glyph;
  }
  const name = document.createElement('span');
  name.className = 'app-name';
  name.textContent = app.name;
  toggle.append(mark,icon,name);

  const description = document.createElement('p');
  description.id = 'desc-' + app.id;
  description.className = 'app-description';
  description.textContent = app.description;
  card.title = app.description;

  const preview = document.createElement('a');
  preview.className = 'app-preview';
  preview.id = 'try-' + app.id;
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
  if (app.id === 'spotify') {
    const setup = document.createElement('a');
    setup.className = 'app-preview';
    setup.href = '../spotify/#developer-setup';
    setup.textContent = 'About library access';
    card.append(setup);
  }
  toggle.addEventListener('click', () => {
    const choices=new Set(community?getCommunitySelection():getSelectedApps());
    const enable = !choices.has(app.id);
    if (enable) lastAdded = app.id;
    if (community) {
      if (enable) choices.add(app.id);
      else choices.delete(app.id);
      selectCommunity([...choices]);
    } else setAppSelected(app.id, enable);
  });
  cards.set(app.id,{card,toggle,mark,preview,excluded,community});
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
  const items = [...catalog.filter(app => selected.has(app.id)),
    ...communityApps.filter(app => communityIds.includes(app.id))];
  const rows = layoutApps(items.map(app => [app.name, app.id]));
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
  for (const [id,{card,toggle,mark,preview,excluded,community}] of cards) {
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
  renderOrder(selected);
  const total=selected.size+communityIds.length;
  count.textContent = total + (total === 1 ? ' app selected' : ' apps selected');
  menuPreview.href = previewUrl(selected);
  drawSelected();
}

// The preview return link also carries the choices for browsers that block storage.
const returnUrl = new URL(location.href);
if(returnUrl.searchParams.has('community')) {
  selectCommunity(returnUrl.searchParams.get('community').split(','));
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
for(const app of communityApps) form.querySelector('#community-apps').append(makeCard(app,true));
const importer=document.querySelector('#community-import');
const appLink=document.querySelector('#lab-app-link');
const importStatus=document.querySelector('#community-status');
importer.onsubmit=event=>{
  event.preventDefault();
  const id=labAlias(appLink.value);
  if (!id) {
    importStatus.textContent = 'Paste the link from a Flipper Lab app page.';
    return;
  }
  if (!communityAvailable(id)) {
    importStatus.textContent = 'This app has no compatible package in this Eddy release.';
    return;
  }
  const selected=getCommunitySelection();
  const name=communityApps.find(app=>app.id===id).name;
  importStatus.textContent=selected.includes(id)?name+' is already selected.':name+' added to your build.';
  lastAdded = id;
  selectCommunity([...selected, id]);
  appLink.value = '';
};
window.addEventListener('eddy-apps-changed',sync);
launcherArt.addEventListener('load', drawSelected);
window.addEventListener('pageshow',sync);
sync();
