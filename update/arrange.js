import {catalog, launcherColumns, launcherPageSize, defaultAppOrder, installedAppOrder, getAppOrder, setAppOrder} from '../app-catalog.js';

import {communityApps, previewId} from '../community-apps.js';

export function appArranger(onMove, makeIcon) {
  const grid = document.querySelector('.arrange-pages');
  const help = document.getElementById('arrange-help');
  const reset = document.getElementById('reset-order');
  const status = document.getElementById('arrange-status');
  let drag;

  function tileFor(app,id,duplicateName) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'app-slot included';
    tile.dataset.id = id;
    const community = id.startsWith('lab:');
    const name = duplicateName ? app.name + (community ? ' (Flipper Lab: ' + app.id + ')' : ' (built-in)') : app.name;
    tile.dataset.name = name;
    if (duplicateName) { tile.setAttribute('aria-label',name); tile.title = name; }
    tile.setAttribute('aria-describedby','arrange-keys');
    tile.append(makeIcon(app,community),document.createTextNode(app.name));
    return tile;
  }

  function finishDrag() {
    if (!drag) return;
    const {source,target,image,frame,pointer} = drag;
    drag = null;
    cancelAnimationFrame(frame);
    image?.remove();
    source.classList.remove('drag-source');
    target?.classList.remove('drop-target');
    grid.classList.remove('dragging');
    if (grid.hasPointerCapture(pointer)) grid.releasePointerCapture(pointer);
  }

  function render(selected,communityIds) {
    finishDrag();
    const visible = installedAppOrder(getAppOrder(), selected, communityIds);
    const focusedId = grid.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const records = new Map(catalog.map(app => [app.id, app]));
    for (const app of communityApps) records.set(previewId(app), app);
    const names = visible.map(id => records.get(id).name.toLowerCase());
    const groups = document.createDocumentFragment();
    for (let start = 0; start < visible.length; start += launcherPageSize) {
      const number = Math.floor(start / launcherPageSize) + 1;
      const group = document.createElement('div');
      const heading = document.createElement('h3');
      heading.id = 'order-heading-' + number;
      heading.textContent = 'Page ' + number;
      const page = document.createElement('div');
      page.id = 'order-page-' + number;
      page.className = 'slot-grid';
      page.setAttribute('role','group');
      page.setAttribute('aria-labelledby',heading.id);
      for (const id of visible.slice(start, start + launcherPageSize)) {
        const app = records.get(id), name = app.name.toLowerCase();
        page.append(tileFor(app,id,names.indexOf(name) !== names.lastIndexOf(name)));
      }
      group.append(heading,page);
      groups.append(group);
    }
    grid.replaceChildren(groups);
    if (focusedId) grid.querySelector('[data-id="' + CSS.escape(focusedId) + '"]')?.focus({preventScroll:true});
    help.textContent = visible.length > 1 ? 'Drag an app onto another to swap positions, or use the arrow keys on a focused app.' :
      visible.length ? 'Add another app to rearrange your menu.' : 'Select apps below to arrange your menu.';
    const original = installedAppOrder(defaultAppOrder, selected, communityIds);
    reset.disabled = visible.every((id,i) => id === original[i]);
    status.textContent = '';
  }

  function swap(source,target,followFocus = false) {
    if (!target || source === target || source.matches(':disabled')) return;
    const order = getAppOrder();
    const from = order.indexOf(source.dataset.id), to = order.indexOf(target.dataset.id);
    if (from < 0 || to < 0) return;
    [order[from],order[to]] = [order[to],order[from]];
    onMove(source.dataset.id);
    setAppOrder(order);
    const positions = [...grid.querySelectorAll('.app-slot')];
    const index = positions.findIndex(tile => tile.dataset.id === source.dataset.id);
    if (followFocus) positions[index]?.scrollIntoView({block:'nearest',behavior:'instant'});
    status.textContent = source.dataset.name + ' moved to page ' + (Math.floor(index/launcherPageSize)+1) +
      ', position ' + (index%launcherPageSize+1) + '.';
  }

  // A captured pointer keeps the drag alive between tiles, including across pages on touch.
  grid.addEventListener('pointerdown', event => {
    const source = event.target.closest('.app-slot');
    if (!source || !event.isPrimary || event.button !== 0 || source.matches(':disabled') || drag) return;
    const rect = source.getBoundingClientRect();
    drag = {source,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,
      offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
    grid.setPointerCapture(event.pointerId);
  });

  function targetAt(x,y) {
    const tile = document.elementFromPoint(x,y)?.closest('.app-slot');
    return grid.contains(tile) ? tile : null;
  }

  function updateTarget() {
    const target = targetAt(drag.x,drag.y);
    if (drag.target !== target) {
      drag.target?.classList.remove('drop-target');
      drag.target = target;
      if (target !== drag.source) target?.classList.add('drop-target');
    }
  }

  function scrollAtEdge() {
    if (!drag?.image) return;
    const edge = Math.min(64,innerHeight/8);
    const distance = drag.y < edge ? drag.y-edge : Math.max(0,drag.y-innerHeight+edge);
    if (distance) {
      window.scrollBy({top:Math.sign(distance)*Math.min(16,Math.ceil(Math.abs(distance)/4)),behavior:'instant'});
      updateTarget();
      drag.frame = requestAnimationFrame(scrollAtEdge);
    } else drag.frame = 0;
  }

  grid.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.image) {
      if (Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<5) return;
      const image = drag.source.cloneNode(true);
      const glyph = drag.source.querySelector('canvas');
      if (glyph) image.querySelector('canvas').getContext('2d')?.drawImage(glyph,0,0);
      image.classList.add('drag-image');
      image.setAttribute('aria-hidden','true');
      image.tabIndex = -1;
      image.style.width = drag.source.offsetWidth+'px';
      grid.after(image);
      drag.image = image;
      drag.source.classList.add('drag-source');
      grid.classList.add('dragging');
    }
    drag.image.style.left = (drag.x-drag.offsetX)+'px';
    drag.image.style.top = (drag.y-drag.offsetY)+'px';
    updateTarget();
    if (!drag.frame) drag.frame = requestAnimationFrame(scrollAtEdge);
  });

  grid.addEventListener('pointerup', event => {
    if (drag?.pointer !== event.pointerId) return;
    const source = drag.source;
    const target = drag.image && targetAt(event.clientX,event.clientY);
    finishDrag();
    swap(source,target);
  });
  for (const type of ['pointercancel','lostpointercapture']) {
    grid.addEventListener(type,event => { if (event.pointerId === drag?.pointer) finishDrag(); });
  }
  window.addEventListener('keydown',event => { if (event.key === 'Escape') finishDrag(); });
  grid.addEventListener('keydown',event => {
    const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-launcherColumns,ArrowDown:launcherColumns}[event.key];
    if (!offset || !event.target.matches('.app-slot')) return;
    event.preventDefault();
    const positions = [...grid.querySelectorAll('.app-slot')];
    const from = positions.indexOf(event.target);
    let to = from + offset;
    if (offset === launcherColumns &&
        Math.floor(from / launcherColumns) < Math.floor((positions.length - 1) / launcherColumns)) {
      to = Math.min(to,positions.length - 1);
    }
    swap(event.target,positions[to],true);
  });
  reset.addEventListener('click',() => {
    onMove(null);
    setAppOrder(defaultAppOrder);
    status.textContent = 'Default order restored.';
  });
  return render;
}
