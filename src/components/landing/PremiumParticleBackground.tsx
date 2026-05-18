import { useEffect, useRef } from 'react';

export type ParticleTone = 'primary' | 'accent' | 'success';

interface PremiumParticleBackgroundProps {
  activeTone: ParticleTone | null;
}

type Rgb = [number, number, number];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseSize: number;
  pulse: number;
  pulseSpeed: number;
  alpha: number;
  alphaSpeed: number;
  depth: number;
  tone: number;
  colorSlot: number;
};

type ParticleSeed = {
  index: number;
  total: number;
};

type ParticleViewportProfile = {
  count: number;
  sizeScale: number;
  driftScale: number;
  parallaxScale: number;
  glowScale: number;
};

const FALLBACK_COLORS: Record<ParticleTone, Rgb> = {
  primary: [255, 51, 71],
  accent: [154, 92, 246],
  success: [16, 185, 129],
};

const lerp = (current: number, target: number, ease: number) => current + (target - current) * ease;

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
};

const readThemeColor = (name: ParticleTone): Rgb => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const [h, s, l] = raw.split(/\s+/).map(value => Number(value.replace('%', '')));
  return Number.isFinite(h) && Number.isFinite(s) && Number.isFinite(l)
    ? hslToRgb(h, s, l)
    : FALLBACK_COLORS[name];
};

const blendColor = (from: Rgb, to: Rgb, amount: number): Rgb => [
  lerp(from[0], to[0], amount),
  lerp(from[1], to[1], amount),
  lerp(from[2], to[2], amount),
];

const colorString = (rgb: Rgb, alpha: number) => (
  `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`
);

const getViewportProfile = (viewportWidth: number, viewportHeight: number): ParticleViewportProfile => {
  const shortSide = Math.min(viewportWidth, viewportHeight);

  if (viewportWidth < 420 || shortSide < 420) {
    return { count: 24, sizeScale: 0.42, driftScale: 0.55, parallaxScale: 0.45, glowScale: 0.72 };
  }

  if (viewportWidth < 640) {
    return { count: 36, sizeScale: 0.5, driftScale: 0.62, parallaxScale: 0.52, glowScale: 0.78 };
  }

  if (viewportWidth < 840) {
    return { count: 58, sizeScale: 0.64, driftScale: 0.72, parallaxScale: 0.64, glowScale: 0.84 };
  }

  if (viewportWidth < 1024) {
    return { count: 86, sizeScale: 0.78, driftScale: 0.84, parallaxScale: 0.78, glowScale: 0.92 };
  }

  if (viewportWidth < 1280) {
    return { count: 118, sizeScale: 0.9, driftScale: 0.94, parallaxScale: 0.9, glowScale: 0.96 };
  }

  return { count: 154, sizeScale: 1, driftScale: 1, parallaxScale: 1, glowScale: 1 };
};

export function PremiumParticleBackground({ activeTone }: PremiumParticleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeToneRef = useRef<ParticleTone | null>(activeTone);

  useEffect(() => {
    activeToneRef.current = activeTone;
  }, [activeTone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let currentColor: Rgb = [...FALLBACK_COLORS.primary];
    let glow = 0.85;
    let hoverLevel = 0;
    let viewportProfile: ParticleViewportProfile = getViewportProfile(window.innerWidth, window.innerHeight);
    let particles: Particle[] = [];
    const mouse = { x: 0, y: 0, active: false };
    const themeColors = {
      primary: readThemeColor('primary'),
      accent: readThemeColor('accent'),
      success: readThemeColor('success'),
    };

    const makeParticle = ({ index, total }: ParticleSeed): Particle => {
      const columns = Math.ceil(Math.sqrt(total * (width / Math.max(height, 1))));
      const rows = Math.ceil(total / columns);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      const xJitter = (Math.random() - 0.5) * cellWidth * 0.58;
      const yJitter = (Math.random() - 0.5) * cellHeight * 0.58;

      return {
        x: (column + 0.5) * cellWidth + xJitter,
        y: (row + 0.5) * cellHeight + yJitter,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.16,
        baseSize: 3 + Math.pow(Math.random(), 1.7) * 12,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.0022 + Math.random() * 0.0038,
        alpha: 0.16 + Math.random() * 0.46,
        alphaSpeed: 0.0009 + Math.random() * 0.0018,
        depth: 0.35 + Math.random() * 1.3,
        tone: 0.65 + Math.random() * 0.7,
        colorSlot: index % 2,
      };
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      viewportProfile = getViewportProfile(width, height);
      const targetCount = viewportProfile.count;
      particles = Array.from({ length: targetCount }, (_, index) => particles[index] ?? makeParticle({ index, total: targetCount }));
    };

    const getIdleMix = (time: number) => {
      const cycle = 0.5 + Math.sin(time * 0.00055) * 0.5;
      return cycle * cycle * (3 - 2 * cycle);
    };

    const getIdleColor = (time: number, colorSlot = 0): Rgb => {
      const mix = getIdleMix(time);
      return blendColor(
        themeColors.primary,
        themeColors.accent,
        colorSlot === 0 ? mix : 1 - mix,
      );
    };

    const onPointerMove = (event: PointerEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      mouse.active = true;
    };

    const onPointerLeave = () => {
      mouse.active = false;
    };

    const drawParticle = (particle: Particle, time: number) => {
      particle.x += particle.vx * particle.depth;
      particle.y += particle.vy * particle.depth;

      if (particle.x < -60) particle.x = width + 60;
      if (particle.x > width + 60) particle.x = -60;
      if (particle.y < -60) particle.y = height + 60;
      if (particle.y > height + 60) particle.y = -60;

      const layer = particle.depth;
      const perspective = 0.68 + layer * 0.22;
      const parallaxX = mouse.active ? ((mouse.x / Math.max(width, 1)) - 0.5) * 26 * layer * viewportProfile.parallaxScale : 0;
      const parallaxY = mouse.active ? ((mouse.y / Math.max(height, 1)) - 0.5) * 18 * layer * viewportProfile.parallaxScale : 0;
      const driftX = Math.sin(time * (0.00022 + layer * 0.00008) + particle.pulse) * 20 * layer * viewportProfile.driftScale;
      const driftY = Math.cos(time * (0.0002 + layer * 0.00006) + particle.pulse * 0.8) * 18 * layer * viewportProfile.driftScale;
      const x = particle.x + driftX - parallaxX;
      const y = particle.y + driftY - parallaxY;
      const dx = mouse.x - x;
      const dy = mouse.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const mouseInfluence = mouse.active ? Math.max(0, 1 - distance / 180) : 0;
      const pulse = 0.5 + Math.sin(time * particle.pulseSpeed + particle.pulse) * 0.5;
      const fade = 0.48 + Math.sin(time * particle.alphaSpeed + particle.pulse * 1.7) * 0.32;
      const size = particle.baseSize * viewportProfile.sizeScale * perspective * (0.72 + pulse * 0.28 + mouseInfluence * 0.74 + hoverLevel * 0.26);
      const idlePresence = 1 - hoverLevel;
      const alpha = Math.min(0.9, (particle.alpha * fade * particle.tone * (0.94 + layer * 0.26) + mouseInfluence * 0.16 + hoverLevel * 0.17 + idlePresence * 0.075) * viewportProfile.glowScale);
      const idleColor = getIdleColor(time, particle.colorSlot);
      const baseColor = blendColor(idleColor, currentColor, hoverLevel);
      const particleColor = blendColor(
        [baseColor[0] * 0.46, baseColor[1] * 0.46, baseColor[2] * 0.46],
        [Math.min(255, baseColor[0] * 1.42), Math.min(255, baseColor[1] * 1.42), Math.min(255, baseColor[2] * 1.42)],
        Math.min(1, particle.tone - 0.35),
      );

      const gradient = context.createRadialGradient(x, y, 0, x, y, size * 2.15);
      gradient.addColorStop(0, colorString(particleColor, alpha));
      gradient.addColorStop(0.36, colorString(particleColor, alpha * lerp(0.24, 0.4, hoverLevel)));
      gradient.addColorStop(1, colorString(particleColor, 0));

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, size * 2.15, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = colorString(particleColor, alpha * lerp(0.84, 0.98, hoverLevel));
      context.beginPath();
      context.arc(x, y, size * 0.48, 0, Math.PI * 2);
      context.fill();
    };

    const draw = (time: number) => {
      const active = activeToneRef.current;
      const targetColor = active ? themeColors[active] : getIdleColor(time, 0);
      hoverLevel = lerp(hoverLevel, active ? 1 : 0, active ? 0.055 : 0.038);
      currentColor = blendColor(currentColor, targetColor, active ? 0.045 : 0.018);
      glow = lerp(glow, active ? 1.45 : 1.12, 0.038);

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';

      const vignette = context.createRadialGradient(width * 0.48, height * 0.24, 0, width * 0.52, height * 0.38, Math.max(width, height) * 0.62);
      vignette.addColorStop(0, colorString(currentColor, 0.058 * glow));
      vignette.addColorStop(0.48, colorString(currentColor, 0.026 * glow));
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = 'lighter';
      particles.forEach(particle => drawParticle(particle, time));

      if (!reduceMotion) {
        rafId = requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    rafId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="premium-particle-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="premium-particle-bg__canvas" />
    </div>
  );
}
