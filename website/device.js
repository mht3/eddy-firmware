import {drawHome, ocean} from './home-screen.js';
import {DeviceRenderer, loadGeometry} from './models/renderer.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));



function screen(ctx, phase, frame) {
  ctx.clearRect(0, 0, 128, 64);
  ctx.fillStyle = '#432a14';
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.6;
  ctx.textBaseline = 'top';
  ctx.font = 'bold 8px monospace';
  if (phase < 0.65 || phase >= 1.55) {
    drawHome(ctx, frame);
  } else if (phase < 1.55) {
    const progress = Math.round(clamp((phase - 0.65) / 0.9, 0, 1) * 100);
    ctx.fillText('EDDY UPDATER', 8, 9);
    ctx.fillRect(8, 21, 110, 1);
    ctx.fillText('Writing ' + progress + '%', 8, 30);
    ctx.strokeRect(8.5, 46.5, 109, 8);
    ctx.fillRect(11, 49, Math.round(progress * 1.04), 3);
  }
}


class EddyDevice extends HTMLElement {
  static get observedAttributes() { return ['phase']; }

  constructor() {
    super();
    const root = this.attachShadow({mode:'open'});
    root.innerHTML = `<style>
      :host {display:block;width:100%;aspect-ratio:749/404}
      canvas,img {position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
      canvas,img {filter:drop-shadow(0 1.1rem 1rem rgba(0,9,10,.44))}
      [hidden] {display:none}
    </style><img alt="" hidden><canvas aria-hidden="true"></canvas>`;
    this.canvas = root.querySelector('canvas');
    this.poster = root.querySelector('img');
    this.lcd = document.createElement('canvas');
    this.lcd.width = 128;
    this.lcd.height = 64;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.scheduleDraw = this.scheduleDraw.bind(this);
    this.resize = new ResizeObserver(this.scheduleDraw);
    this.visible = true;
    this.visibility = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.scheduleDraw();
      else clearTimeout(this.idleTimer);
    });
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.renderer = null;
      this.showPoster();
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.initialize());
  }

  connectedCallback() {
    this.setAttribute('role','img');
    this.resize.observe(this);
    this.visibility.observe(this);
    ocean.addEventListener('load',this.scheduleDraw);
    this.reducedMotion.addEventListener('change',this.scheduleDraw);
    this.initialize();
  }

  async initialize() {
    try {
      const models = await loadGeometry();
      if (!this.isConnected || this.renderer) return;
      this.renderer = new DeviceRenderer(this.canvas,models);
      this.scheduleDraw();
    } catch {
      this.showPoster();
    }
  }

  showPoster() {
    const phase = this.progress();
    const pose = phase < 0.65 ? 'desktop' : phase < 1.55 ? 'update' : 'desktop';
    const src = new URL('models/' + pose + '.webp',import.meta.url).href;
    if (this.poster.src !== src) this.poster.src = src;
    this.poster.hidden = false;
    this.canvas.hidden = true;
  }

  disconnectedCallback() {
    this.resize.disconnect();
    this.visibility.disconnect();
    ocean.removeEventListener('load',this.scheduleDraw);
    this.reducedMotion.removeEventListener('change',this.scheduleDraw);
    clearTimeout(this.idleTimer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renderer?.dispose();
    this.renderer = null;
  }

  progress() {
    const input = Number(this.getAttribute('phase'));
    return Number.isFinite(input) ? clamp(input,0,3) : 0;
  }

  attributeChangedCallback() { this.scheduleDraw(); }

  scheduleDraw() {
    if (!this.isConnected || this.frame || !this.visible) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const {width,height} = this.getBoundingClientRect();
      if (!width || !height) return;
      const still = this.reducedMotion.matches;
      const phase = this.progress();
      const state = phase < 0.65 ? 'Eddy the dolphin swimming in an ocean eddy' : phase < 1.55 ?
        'firmware installation preview' : 'Eddy home screen';
      this.setAttribute('aria-label','Flipper Zero with the ' + state);
      if (!this.renderer) {
        if (!this.poster.hidden) this.showPoster();
        return;
      }
      const ratio = Math.min(window.devicePixelRatio || 1,3,Math.sqrt(6000000 / (width*height)));
      const w = Math.round(width*ratio), h = Math.round(height*ratio);
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.canvas.hidden = false;
      const frame = still ? 4 : Math.floor(performance.now()*0.006)%16;
      screen(this.lcd.getContext('2d'),phase,frame);
      this.renderer.draw(this.lcd,phase,still);
      this.poster.hidden = true;
      clearTimeout(this.idleTimer);
      if (!still && this.visible && phase < 0.65) this.idleTimer = setTimeout(this.scheduleDraw,167);
    });
  }
}

customElements.define('eddy-device',EddyDevice);
