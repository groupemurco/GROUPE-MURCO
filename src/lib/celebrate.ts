// Petit moment de joie quand une facture est payée ou créée: confettis brefs, sans bloquer l'écran.
let last = 0;

const COLORS = ['#5b9bff', '#ffad33', '#3fd3a0', '#ffffff', '#ff7a90'];

export function tap(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* pas de vibreur */
  }
}

export function celebrate(): void {
  try {
    tap(24);
    if (typeof document === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = Date.now();
    if (now - last < 8000) return;
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c = document.createElement('canvas');
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    if (!ctx) return c.remove();
    ctx.scale(dpr, dpr);
    const parts = Array.from({ length: 110 }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const v = 9 + Math.random() * 9;
      return { x: w / 2, y: h * 0.72, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, s: 5 + Math.random() * 6, col: COLORS[Math.floor(Math.random() * COLORS.length)] };
    });
    const t0 = performance.now();
    const frame = (t: number) => {
      const k = (t - t0) / 1700;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.38;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - k * k);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (k < 1) requestAnimationFrame(frame);
      else c.remove();
    };
    requestAnimationFrame(frame);
  } catch {
    /* la fête est facultative */
  }
}
