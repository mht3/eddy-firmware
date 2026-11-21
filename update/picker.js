import {catalog, defaultAppOrder, getAppOrder, getSelectedApps, setAppOrder, setAppSelected, setSelectedApps} from '../app-catalog.js';
import {drawLauncher, layoutApps, launcherArt} from '../launcher.js';
import {drawBattery} from '../home-screen.js';

const form = document.getElementById('app-picker');
const screen = document.getElementById('selected-screen');
const menuPreview = document.getElementById('try-app-menu');
const count = document.getElementById('app-count');
const cards = new Map();
let lastAdded;
let swapSource = null;
const swapStatus = document.getElementById('arrange-status');
const resetOrder = document.getElementById('reset-order');
const slots = [];

function slotAddress(i) {
  return 'page ' + (Math.floor(i/8)+1) + ', position ' + (i%8+1);
}

function chooseSlot(i) {
  if (form.disabled) return;
  const order = getAppOrder();
  const name = catalog.find(app => app.id === order[i]).name;
  if (swapSource === null) {
    swapSource = order[i];
    swapStatus.textContent = 'Move ' + name + '. Choose its new position.';
  } else if (swapSource === order[i]) {
    swapSource = null;
    swapStatus.textContent = 'Move canceled.';
  } else {
    const from = order.indexOf(swapSource);
    const moved = catalog.find(app => app.id === swapSource);
    [order[from], order[i]] = [order[i], order[from]];
    lastAdded = moved.id;
    swapSource = null;
    swapStatus.textContent = moved.name + ' moved to ' + slotAddress(i) + '.';
    setAppOrder(order);
  }
  renderOrder(getSelectedApps());
}

function renderOrder(selected) {
  const order = getAppOrder();
  order.forEach((id,i) => {
    const {button,label} = slots[i];
    const name = catalog.find(app => app.id === id).name;
    button.dataset.id = id;
    button.classList.toggle('included', selected.has(id));
    button.setAttribute('aria-pressed',String(swapSource === id));
    button.setAttribute('aria-label',name + ', ' + slotAddress(i) + (selected.has(id) ? '' : ', excluded'));
    label.textContent = name;
  });
  resetOrder.disabled = order.every((id,i) => id === defaultAppOrder[i]);
}

function makeSlots() {
  defaultAppOrder.forEach((_,i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-slot';
    const glyph = document.createElement('span');
    glyph.className = 'app-icon';
    glyph.setAttribute('aria-hidden','true');
    const label = document.createElement('span');
    button.append(glyph,label);
    button.addEventListener('click',() => chooseSlot(i));
    slots.push({button,label});
    document.getElementById(i<8 ? 'order-page-1' : 'order-page-2').append(button);
  });
  resetOrder.addEventListener('click', () => {
    swapSource = null;
    lastAdded = null;
    setAppOrder(defaultAppOrder);
    swapStatus.textContent = 'Default order restored.';
  });
  document.getElementById('arrange-apps').addEventListener('keydown', event => {
    if (event.key === 'Escape' && swapSource !== null) {
      swapSource = null;
      swapStatus.textContent = 'Move canceled.';
      renderOrder(getSelectedApps());
    }
  });
}


function makeCard(app) {
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
  preview.textContent = 'Try in emulator';
  preview.setAttribute('aria-label','Try ' + app.name + ' in emulator');
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
  toggle.addEventListener('click', () => {
    const enable = !getSelectedApps().has(app.id);
    if (enable) lastAdded = app.id;
    setAppSelected(app.id, enable);
  });
  cards.set(app.id,{card,toggle,mark,preview,excluded});
  return card;
}

function previewUrl(selected, id) {
  const url = new URL('../', location.href);
  url.searchParams.set('apps',[...selected].join(','));
  url.searchParams.set('order',getAppOrder().join(','));
  if (id) url.searchParams.set('app',id);
  url.hash = 'home-screen';
  return url.href;
}

function drawSelected() {
  const ctx = screen.getContext('2d');
  if (!ctx) return;
  const selected = getSelectedApps();
  const rows = layoutApps(catalog.filter(app => selected.has(app.id)).map(app => [app.name,app.id]));
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
  for (const [id,{card,toggle,mark,preview,excluded}] of cards) {
    const included = selected.has(id);
    card.classList.toggle('included',included);
    toggle.setAttribute('aria-pressed',String(included));
    mark.textContent = included ? '×' : '+';
    preview.hidden = !included;
    excluded.hidden = included;
    if (included) preview.href = previewUrl(selected,id);
    else preview.removeAttribute('href');
  }
  renderOrder(selected);
  count.textContent = selected.size + (selected.size === 1 ? ' app selected' : ' apps selected');
  menuPreview.href = previewUrl(selected);
  drawSelected();
}

// The preview return link also carries the choices for browsers that block storage.
const returnUrl = new URL(location.href);
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
makeSlots();
for (const app of catalog) {
  form.querySelector(app.core ? '#core-apps' : '#extra-apps').append(makeCard(app));
}
window.addEventListener('eddy-apps-changed',sync);
launcherArt.addEventListener('load', drawSelected);
window.addEventListener('pageshow',sync);
sync();
