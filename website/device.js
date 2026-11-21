// A locally rendered orthographic model. Dimensions below use model space with
// the LCD in the XY plane and positive depth extending behind the front shell.
(() => {
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const ease = v => v * v * (3 - 2 * v);

  function gradient(ctx, x1, y1, x2, y2, stops) {
    const paint = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const [offset, color] of stops) paint.addColorStop(offset, color);
    return paint;
  }

  function rounded(ctx, x, y, width, height, radius, paint) {
    ctx.fillStyle = paint;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }

  function disk(ctx, x, y, r, paint) {
    ctx.fillStyle = paint;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const shell = new Path2D(
    'M -258 -95 Q -246 -110 -221 -110 L 187 -110 Q 218 -110 241 -91 ' +
    'L 264 -69 Q 278 -54 278 -27 L 278 44 Q 278 72 256 88 ' +
    'L 237 101 Q 220 112 192 112 L -215 112 Q -243 112 -258 94 ' +
    'L -276 71 Q -287 57 -287 33 L -287 -33 Q -287 -56 -277 -71 Z'
  );

  function shade(ctx, x, y, w, h, strength) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    const paint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    paint.addColorStop(0, 'rgba(0,12,17,' + strength + ')');
    paint.addColorStop(1, 'rgba(0,12,17,0)');
    disk(ctx, 0, 0, 1, paint);
    ctx.restore();
  }

  const ocean = new Image();
  ocean.src = new URL('eddy-ocean.png', import.meta.url).href;

  function screen(ctx, phase, frame) {
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = '#432a14';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.6;
    ctx.textBaseline = 'top';
    ctx.font = 'bold 8px monospace';
    if (phase < 0.65) {
      if (ocean.naturalWidth) {
        ctx.drawImage(ocean, frame * 128, 0, 128, 50, 0, 14, 128, 50);
      }
      ctx.font = 'bold 8px monospace';
      ctx.fillText('EDDY', 6, 2);
      ctx.fillRect(5, 12, 118, 1);
    } else if (phase < 1.55) {
      const progress = Math.round(clamp((phase - 0.65) / 0.9, 0, 1) * 100);
      ctx.fillText('EDDY UPDATER', 8, 9);
      ctx.fillRect(8, 21, 110, 1);
      ctx.fillText('Writing ' + progress + '%', 8, 30);
      ctx.strokeRect(8.5, 46.5, 109, 8);
      ctx.fillRect(11, 49, Math.round(progress * 1.04), 3);
    } else if (phase < 2.55) {
      ctx.fillText('Signal Meter', 6, 7);
      ctx.fillRect(6, 19, 116, 1);
      const sweep = ease(clamp((phase - 1.55), 0, 1));
      for (let i = 0; i < 29; i++) {
        const peak = Math.exp(-Math.pow((i - 5 - sweep * 18) / 2.2, 2));
        const height = Math.round(3 + peak * 24 + 4 * Math.abs(Math.sin(i * 1.82)));
        ctx.fillRect(7 + i * 4, 53 - height, 2, height);
      }
      ctx.fillRect(6, 55, 116, 1);
    } else {
      ctx.fillText('Eddy Settings', 7, 6);
      ctx.fillRect(7, 18, 113, 1);
      const rows = ['Interface', 'Menu style', 'Backlight'];
      const chosen = Math.min(2, Math.floor((phase - 2.55) * 6));
      rows.forEach((row, i) => {
        const top = 23 + i * 12;
        ctx.fillStyle = '#432a14';
        if (chosen === i) {
          ctx.fillRect(6, top - 1, 116, 11);
          ctx.fillStyle = '#e4ac64';
        }
        ctx.fillText(row, 11, top);
      });
    }
  }

  function drawFace(ctx, lcd) {
    ctx.fillStyle = gradient(ctx, -90, -118, 60, 117,
      [[0, '#fffdf1'], [0.46, '#f5f2e7'], [0.85, '#e9e5d7'], [1, '#d3d0c3']]);
    ctx.fill(shell);
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = '#fffdf3';
    ctx.stroke(shell);

    // Recessed bezel, polarizer and a low-contrast LCD pixel grid.
    rounded(ctx, -224, -63, 281, 129, 13, '#d7d2c6');
    rounded(ctx, -224, -65, 281, 128, 13, '#bcb8ab');
    rounded(ctx, -221, -62, 275, 122, 11,
      gradient(ctx, 0, -62, 22, 60, [[0, '#433d32'], [0.72, '#80705b'], [1, '#564b3b']]));
    rounded(ctx, -210, -55, 251, 108, 6,
      gradient(ctx, -170, -50, -120, 58, [[0, '#d89c57'], [0.58, '#efb96e'], [1, '#e4a25a']]));
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = '#764315';
    for (let x = -208; x < 38; x += 2) ctx.fillRect(x, -52, 0.32, 102);
    for (let y = -52; y < 51; y += 1.62) ctx.fillRect(-208, y, 246, 0.22);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lcd, -205, -51, 239, 101);

    ctx.fillStyle = '#8d897b';
    ctx.font = 'bold 8px monospace';
    ctx.fillText('FLIPPER ZERO', -219, 81);
    disk(ctx, 47, -77, 4.8, '#cac6b9');
    disk(ctx, 47, -77, 3.1, '#93b7a1');

    const thumb = gradient(ctx, 120, -66, 182, 61,
      [[0, '#ffa54e'], [0.39, '#ff8732'], [0.79, '#f47426'], [1, '#dc591c']]);
    disk(ctx, 151, -4, 61, '#d4cfc1');
    disk(ctx, 151, -7, 60, '#a69d8b');
    disk(ctx, 151, -7, 57, '#cb581e');
    disk(ctx, 151, -10, 55.5, thumb);
    disk(ctx, 151, -10, 27.4, '#bc541c');
    disk(ctx, 151, -9, 25.4, '#f7a351');
    disk(ctx, 151, -10.8, 24.7, thumb);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(151, -10);
      ctx.rotate(i * Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-5, -37);
      ctx.lineTo(0, -42);
      ctx.lineTo(5, -37);
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#cc601f';
      ctx.stroke();
      ctx.restore();
    }
    disk(ctx, 218, 62, 18.5, '#bfb7a6');
    disk(ctx, 218, 61, 16.7, '#d86423');
    disk(ctx, 218, 59, 15.2, '#fc8a39');
    ctx.beginPath();
    ctx.moveTo(213, 59);
    ctx.lineTo(222, 59);
    ctx.lineTo(222, 55);
    ctx.moveTo(213, 59);
    ctx.lineTo(216, 56);
    ctx.moveTo(213, 59);
    ctx.lineTo(216, 62);
    ctx.strokeStyle = '#c85a20';
    ctx.lineWidth = 1.7;
    ctx.stroke();
  }

  function render(ctx, width, height, phase, lcd, still) {
    const scale = Math.min(width / 749, height / 404);
    const angle = still ? -0.175 : -0.21 + ease(clamp(phase / 3, 0, 1)) * 0.13;
    ctx.save();
    ctx.translate(width * 0.47, height * 0.53);
    ctx.scale(scale, scale);
    ctx.rotate(angle);
    const skew = 0.24;
    const foreshorten = 0.86;
    const depthX = 0.48;
    const depthY = -0.61;
    const facePlane = depth => ctx.transform(1, 0, skew, foreshorten, depth * depthX, depth * depthY);
    const topPlane = () => ctx.transform(1, 0, depthX, depthY, -110 * skew, -110 * foreshorten);
    const endPlane = () => ctx.transform(skew, foreshorten, depthX, depthY, 278, 0);
    shade(ctx, 12, 107, 320, 45, 0.48);

    // Closely spaced cross sections give the cast casing its fillets, curved
    // end faces and horizontal parting line under changing camera angles.
    for (let depth = 76; depth >= 1; depth--) {
      ctx.save();
      facePlane(depth);
      const rim = depth > 65 ? (depth - 65) / 11 : Math.max(0, (11 - depth) / 11);
      const inset = rim * rim;
      ctx.scale(1 - inset * 0.025, 1 - inset * 0.06);
      const highlight = 12 * Math.cos(depth / 76 * Math.PI);
      const light = Math.round(175 + highlight);
      const seam = depth === 39 || depth === 40;
      ctx.fillStyle = seam ? '#8c897d' : gradient(ctx, -180, -100, 286, 90,
        [[0, 'rgb(' + (light + 17) + ',' + (light + 18) + ',' + (light + 9) + ')'],
          [0.65, 'rgb(' + (light + 32) + ',' + (light + 29) + ',' + (light + 17) + ')'],
          [1, 'rgb(' + (light - 14) + ',' + (light - 13) + ',' + (light - 22) + ')']]);
      ctx.fill(shell);
      ctx.restore();
    }
    ctx.save();
    topPlane();
    // Two recessed GPIO headers are mounted into the top edge.
    for (const [start, count] of [[-155, 8], [-32, 10]]) {
      rounded(ctx, start - 4, 17, count * 12 + 6, 25, 3, '#c2bfb1');
      rounded(ctx, start, 20, count * 12 - 1, 18, 2, '#514e45');
      for (let pin = 0; pin < count; pin++) {
        rounded(ctx, start + 2 + pin * 12, 23, 8, 11, 1, '#1e201b');
        ctx.fillStyle = '#a49473';
        ctx.fillRect(start + 4 + pin * 12, 29, 4, 2);
      }
    }
    ctx.restore();

    ctx.save();
    endPlane();
    rounded(ctx, -15, 19, 37, 26, 9, '#a5a395');
    rounded(ctx, -14, 21, 35, 22, 9, '#676a63');
    rounded(ctx, -12, 23, 31, 18, 7, '#232a27');
    rounded(ctx, -8, 31, 24, 3.5, 1.5, '#9c9b8f');
    ctx.restore();

    ctx.save();
    facePlane(0);
    ctx.scale(0.975, 0.94);
    drawFace(ctx, lcd);
    ctx.restore();

    // The plug slides along the port axis. Past the scan sequence it leaves
    // the frame so the final upright device can be seen on its own.
    const connected = ease(clamp(phase / 0.78, 0, 1));
    const withdrawn = ease(clamp((phase - 1.55) / 0.75, 0, 1));
    const gap = (1 - connected) * 125 + withdrawn * 170;
    const plugX = 278 + depthX * 32 + 0.24 * 3 + gap;
    const plugY = depthY * 32 + 0.86 * 3;
    ctx.save();
    ctx.translate(plugX, plugY);
    const exposed = clamp(gap, 0, 15);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(exposed + 58, 0);
    ctx.bezierCurveTo(177, -1, 126, 115, 250, 119);
    ctx.bezierCurveTo(325, 121, 375, 83, 490, 125);
    for (const [thickness, paint] of [[10, '#172b2c'], [7, '#465554'], [2.5, '#788681']]) {
      ctx.lineWidth = thickness;
      ctx.strokeStyle = paint;
      ctx.stroke();
      ctx.translate(0, -0.8);
    }
    const metal = gradient(ctx, 2, -9, 5, 10,
      [[0, '#d4d4bd'], [0.38, '#fbfbe9'], [0.64, '#a3a99c'], [1, '#747e72']]);
    rounded(ctx, 0, -6.5, exposed + 1, 13.5, 1, metal);
    rounded(ctx, exposed, -11, 48, 23, 6,
      gradient(ctx, 0, -12, 0, 13, [[0, '#939f96'], [0.16, '#62716b'], [0.72, '#3b4b47'], [1, '#283834']]));
    rounded(ctx, exposed + 45, -7.5, 17, 15, 3.8, '#455550');
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#31423e';
      ctx.fillRect(exposed + 49 + i * 3, -6.5, 1, 13);
    }
    ctx.restore();
    ctx.restore();
  }

  class EddyDevice extends HTMLElement {
    static get observedAttributes() { return ['phase']; }

    constructor() {
      super();
      this.attachShadow({mode: 'open'});
      this.shadowRoot.innerHTML = '<style>:host{display:block;width:100%;aspect-ratio:749/404}canvas{display:block;width:100%;height:100%}</style><canvas aria-hidden="true"></canvas>';
      this.canvas = this.shadowRoot.querySelector('canvas');
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
      });
    }

    connectedCallback() {
      this.setAttribute('role', 'img');
      this.resize.observe(this);
      this.visibility.observe(this);
      ocean.addEventListener('load', this.scheduleDraw);
      this.reducedMotion.addEventListener('change', this.scheduleDraw);
      this.scheduleDraw();
    }

    disconnectedCallback() {
      this.resize.disconnect();
      this.visibility.disconnect();
      ocean.removeEventListener('load', this.scheduleDraw);
      clearTimeout(this.idleTimer);
      this.reducedMotion.removeEventListener('change', this.scheduleDraw);
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    attributeChangedCallback() { this.scheduleDraw(); }

    scheduleDraw() {
      if (!this.isConnected || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const { width, height } = this.getBoundingClientRect();
        if (!width || !height) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const pxWidth = Math.round(width * ratio);
        const pxHeight = Math.round(height * ratio);
        if (this.canvas.width !== pxWidth) this.canvas.width = pxWidth;
        if (this.canvas.height !== pxHeight) this.canvas.height = pxHeight;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        const input = Number(this.getAttribute('phase'));
        const progress = Number.isFinite(input) ? clamp(input, 0, 3) : 0;
        const still = this.reducedMotion.matches;
        const phase = still ? Math.round(progress) : progress;
        const state = phase < 0.65 ? 'Eddy the dolphin swimming in an ocean eddy' : phase < 1.55 ? 'firmware installation preview' :
          phase < 2.55 ? 'Signal Meter preview' : 'Eddy Settings preview';
        this.setAttribute('aria-label', 'Flipper Zero with the ' + state);
        const idleFrame = still ? 4 : Math.floor(performance.now() * 0.006) % 16;
        screen(this.lcd.getContext('2d'), phase, idleFrame);
        clearTimeout(this.idleTimer);
        if (this.visible && !still && phase < 0.65) {
          this.idleTimer = setTimeout(this.scheduleDraw, 167);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        render(ctx, width, height, phase, this.lcd, still);
      });
    }
  }

  if (!customElements.get('eddy-device')) customElements.define('eddy-device', EddyDevice);
})();
