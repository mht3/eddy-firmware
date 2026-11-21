import {catalog, defaultAppOrder, getAppOrder, getSelectedApps, setAppOrder} from '../app-catalog.js';

export function appArranger(onMove) {
  const grid = document.querySelector('.arrange-pages');
  const pages = [...grid.querySelectorAll('.slot-grid')];
  const help = document.getElementById('arrange-help');
  const reset = document.getElementById('reset-order');
  const status = document.getElementById('arrange-status');
  const tiles = new Map();
  let drag;

  for (const {id,name} of catalog) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'app-slot included';
    tile.dataset.id = id;
    tile.setAttribute('aria-describedby','arrange-keys');
    const icon = document.createElement('span');
    icon.className = 'app-icon';
    icon.setAttribute('aria-hidden','true');
    tile.append(icon,document.createTextNode(name));
    tiles.set(id,tile);
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

  function render(selected) {
    finishDrag();
    const visible = getAppOrder().filter(id => selected.has(id));
    const focused = document.activeElement;
    pages.forEach((page,i) => {
      const group = visible.slice(i*8,i*8+8);
      page.parentElement.hidden = !group.length;
      page.replaceChildren(...group.map(id => tiles.get(id)));
    });
    if (grid.contains(focused)) focused.focus({preventScroll:true});
    help.textContent = visible.length > 1 ? 'Drag an app onto another to swap positions.' :
      visible.length ? 'Add another app to rearrange your menu.' : 'Select apps below to arrange your menu.';
    reset.disabled = visible.join() === defaultAppOrder.filter(id => selected.has(id)).join();
    status.textContent = '';
  }

  function swap(source,target) {
    if (!target || source === target || source.matches(':disabled')) return;
    const order = getAppOrder();
    const from = order.indexOf(source.dataset.id), to = order.indexOf(target.dataset.id);
    [order[from],order[to]] = [order[to],order[from]];
    onMove(source.dataset.id);
    setAppOrder(order);
    const positions = [...grid.querySelectorAll('.app-slot')];
    const index = positions.indexOf(source);
    status.textContent = source.textContent + ' moved to page ' + (Math.floor(index/8)+1) +
      ', position ' + (index%8+1) + '.';
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
    const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4}[event.key];
    if (!offset || !event.target.matches('.app-slot')) return;
    event.preventDefault();
    const positions = [...grid.querySelectorAll('.app-slot')];
    swap(event.target,positions[positions.indexOf(event.target)+offset]);
  });
  reset.addEventListener('click',() => {
    onMove(null);
    setAppOrder(defaultAppOrder);
    status.textContent = 'Default order restored.';
  });
  return render;
}
