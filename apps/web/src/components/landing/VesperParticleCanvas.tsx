"use client";

import React, { useEffect, useRef } from "react";

export type VesperMorphMode = "orb" | "vortex" | "neural";

interface VesperParticleCanvasProps {
  mode: VesperMorphMode;
}

interface Particle {
  // Normalized seeds
  u: number;
  v: number;
  w: number;
  colorType: 0 | 1 | 2; // 0 = mint (#34d399), 1 = violet (#a855f7), 2 = cyan (#22d3ee)
  size: number;
  // Current 3D position
  x: number;
  y: number;
  z: number;
}

export function VesperParticleCanvas({ mode }: VesperParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<VesperMorphMode>(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width || window.innerWidth;
      height = rect.height || 680;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Mouse interaction state
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, active: false };
    const onPointerMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      pointer.targetY = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
      pointer.active = true;
    };
    window.addEventListener("mousemove", onPointerMove, { passive: true });

    // Initialize 1,900 volumetric particles
    const COUNT = 1900;
    const particles: Particle[] = [];
    for (let i = 0; i < COUNT; i++) {
      // Fibonacci sphere / uniform random seeds
      const u = (i + 0.5) / COUNT;
      const v = ((i * 0.618033988749895) % 1);
      const w = ((i * 0.381966011250105) % 1);
      const colorType: 0 | 1 | 2 = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
      const size = 1.0 + (i % 5) * 0.32;
      particles.push({ u, v, w, colorType, size, x: 0, y: 0, z: 0 });
    }

    const computeTarget = (p: Particle, m: VesperMorphMode, t: number): [number, number, number] => {
      const phi = Math.acos(1 - 2 * p.u);
      const theta = 2 * Math.PI * p.v * 12;

      if (m === "orb") {
        // Breathing multi-shell orb with harmonic surface ripples
        const wave = Math.sin(phi * 6 + t * 1.8) * 14 + Math.cos(theta * 3 - t * 1.4) * 10;
        const r = (175 + (p.w - 0.5) * 42 + wave);
        const x = r * Math.sin(phi) * Math.cos(theta + t * 0.25);
        const y = r * Math.cos(phi) + Math.sin(t * 1.1 + p.u * 8) * 8;
        const z = r * Math.sin(phi) * Math.sin(theta + t * 0.25);
        return [x, y, z];
      }

      if (m === "vortex") {
        // Spiral galaxy / deep perimeter scan vortex
        const arms = 3;
        const armAngle = ((Math.floor(p.w * arms) / arms) * Math.PI * 2);
        const radius = 28 + Math.pow(p.u, 0.72) * 285;
        const spin = p.u * 9.5 - t * 0.85 + armAngle;
        const scatter = (p.v - 0.5) * (24 + p.u * 40);
        const x = Math.cos(spin) * radius + Math.cos(theta) * scatter * 0.45;
        const z = Math.sin(spin) * radius + Math.sin(theta) * scatter * 0.45;
        const y = Math.sin(p.u * Math.PI * 4 - t * 1.5) * 28 + (p.w - 0.5) * 34 * (1 - p.u * 0.6);
        return [x, y, z];
      }

      // "neural" — Dual-hemisphere thinking brain / cryptographic shield lattice
      const hemi = p.w > 0.5 ? 1 : -1;
      const rBase = 135 + Math.sin(phi * 8 + theta * 2) * 18;
      const x = hemi * (32 + Math.abs(Math.sin(phi) * Math.cos(theta)) * rBase * 1.05);
      const y = Math.cos(phi) * (rBase * 0.88) + Math.sin(theta * 4 + t * 1.6) * 7;
      const z = Math.sin(phi) * Math.sin(theta) * (rBase * 1.18);
      return [x, y, z];
    };

    // Seed initial positions
    for (const p of particles) {
      const [tx, ty, tz] = computeTarget(p, modeRef.current, 0);
      p.x = tx;
      p.y = ty;
      p.z = tz;
    }

    let startTime = performance.now();

    const render = (now: number) => {
      const t = (now - startTime) * 0.001;
      ctx.clearRect(0, 0, width, height);

      // Smooth pointer interpolation
      pointer.x += (pointer.targetX - pointer.x) * 0.06;
      pointer.y += (pointer.targetY - pointer.y) * 0.06;

      const cx = width * 0.5;
      const cy = height * 0.47;

      // Ambient Vesper core glow (Mint + Violet + Cyan)
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.min(width, height) * 0.52);
      grad.addColorStop(0, "rgba(52, 211, 153, 0.16)");
      grad.addColorStop(0.42, "rgba(168, 85, 247, 0.12)");
      grad.addColorStop(0.75, "rgba(34, 211, 238, 0.05)");
      grad.addColorStop(1, "rgba(6, 7, 9, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Global 3D rotation affected by time + cursor
      const rotY = t * 0.22 + pointer.x * 0.55;
      const rotX = Math.sin(t * 0.35) * 0.18 + pointer.y * 0.38;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      const fov = 540;
      const activeMode = modeRef.current;

      for (let i = 0; i < COUNT; i++) {
        const p = particles[i];
        const [tx, ty, tz] = computeTarget(p, activeMode, t);

        // Spring-like morph interpolation
        p.x += (tx - p.x) * 0.065;
        p.y += (ty - p.y) * 0.065;
        p.z += (tz - p.z) * 0.065;

        // Rotate Y then X
        const rx = p.x * cosY - p.z * sinY;
        const rz1 = p.x * sinY + p.z * cosY;
        const ry = p.y * cosX - rz1 * sinX;
        const rz = p.y * sinX + rz1 * cosX;

        const depth = fov + rz + 260;
        if (depth <= 40) continue;
        const scale = fov / depth;
        const sx = cx + rx * scale;
        const sy = cy + ry * scale;

        const alpha = Math.max(0.08, Math.min(0.95, (scale - 0.35) * 1.15));
        const rSize = p.size * scale;

        if (p.colorType === 0) {
          ctx.fillStyle = `rgba(52, 211, 153, ${alpha.toFixed(2)})`; // Mint
        } else if (p.colorType === 1) {
          ctx.fillStyle = `rgba(192, 132, 252, ${alpha.toFixed(2)})`; // Violet
        } else {
          ctx.fillStyle = `rgba(34, 211, 238, ${alpha.toFixed(2)})`; // Cyan
        }

        ctx.beginPath();
        ctx.arc(sx, sy, rSize, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = window.requestAnimationFrame(render);
    };

    animId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none select-none"
      style={{ mixBlendMode: "screen" }}
    />
  );
}
