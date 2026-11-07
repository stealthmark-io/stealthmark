"use client";

import React, { useEffect, useRef } from "react";

// ============================================================================
// 1. GLSL SHADERS (3-STATE MORPHING + 3D CURL TURBULENCE + MOUSE FIELD)
// ============================================================================

const VESPER_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 position;
  attribute vec3 aPositionGalaxy;
  attribute vec3 aPositionBrain;
  attribute float aScale;
  attribute float aRandom;
  attribute float aColorMix;

  uniform mat4 uProjectionMatrix;
  uniform mat4 uViewMatrix;
  uniform mat4 uModelMatrix;
  uniform float uTime;
  uniform float uMorphGalaxy;
  uniform float uMorphBrain;
  uniform vec2 uMouse;
  uniform float uMouseVelocity;
  uniform float uPixelRatio;
  uniform float uPulseBoost;

  varying vec3 vColor;
  varying float vAlpha;

  // Overflow-proof 3D harmonic curl turbulence (runs cleanly on all mobile & desktop GPUs)
  vec3 curlTurbulence(vec3 p, float t) {
    float x = sin(p.y * 2.3 + t * 0.9) * cos(p.z * 1.9 - t * 0.7) + 0.5 * sin(p.z * 4.1 + t * 1.3);
    float y = sin(p.z * 2.5 - t * 0.8) * cos(p.x * 2.1 + t * 0.9) + 0.5 * cos(p.x * 3.8 - t * 1.1);
    float z = sin(p.x * 2.0 + t * 1.0) * cos(p.y * 2.4 - t * 0.6) + 0.5 * sin(p.y * 3.9 + t * 1.2);
    return vec3(x, y, z);
  }

  void main() {
    float tGalaxy = smoothstep(0.0, 1.0, uMorphGalaxy);
    float tBrain = smoothstep(0.0, 1.0, uMorphBrain);

    vec3 pos = mix(position, aPositionGalaxy, tGalaxy);
    pos = mix(pos, aPositionBrain, tBrain);

    float noiseAmp = mix(0.11, 0.045, tBrain) + uPulseBoost * 0.06;
    vec3 noiseVec = curlTurbulence(pos, uTime * 0.65);

    float lenPos = max(0.001, length(pos));
    vec3 radialDir = pos / lenPos;
    float breathe = sin(uTime * (1.35 + uPulseBoost * 1.4) + aRandom * 6.2831) * (0.05 + uPulseBoost * 0.04);
    pos += radialDir * breathe + noiseVec * noiseAmp;

    vec4 worldPosition = uModelMatrix * vec4(pos, 1.0);
    vec2 mouseWorld = uMouse * vec2(2.4, 1.6);
    float distToMouse = length(worldPosition.xy - mouseWorld);
    float mouseInfluence = 1.0 - smoothstep(0.0, 1.35, distToMouse);

    vec2 deltaMouse = worldPosition.xy - mouseWorld;
    float deltaLen = max(0.001, length(deltaMouse));
    vec2 pushDir = deltaMouse / deltaLen;
    float vortexAngle = mouseInfluence * (0.42 + uMouseVelocity * 0.75);
    mat2 rot = mat2(cos(vortexAngle), -sin(vortexAngle), sin(vortexAngle), cos(vortexAngle));
    worldPosition.xy += (rot * pushDir) * mouseInfluence * 0.30;
    worldPosition.z += mouseInfluence * 0.25;

    vec4 viewPosition = uViewMatrix * worldPosition;
    gl_Position = uProjectionMatrix * viewPosition;

    float pulseSize = 1.0 + 0.22 * sin(uTime * 2.4 + aRandom * 12.0) + uPulseBoost * 0.35;
    gl_PointSize = clamp(aScale * pulseSize * uPixelRatio * (5.2 / max(0.8, -viewPosition.z)), 1.0, 4.2);

    vec3 colorMint = vec3(0.310, 1.000, 0.690);   // #4FFFB0
    vec3 colorViolet = vec3(0.541, 0.361, 1.000); // #8A5CFF
    vec3 colorCore = vec3(0.750, 0.960, 0.920);   // Soft Mint-Cyan highlight

    float spatialMix = clamp((pos.x * 0.38 + pos.y * 0.28 + 0.5) * 0.65 + aColorMix * 0.35, 0.0, 1.0);
    vec3 baseColor = mix(colorViolet, colorMint, spatialMix);

    float highlight = clamp(mouseInfluence * 0.75 + pow(aRandom, 8.0) * 0.45 + uPulseBoost * 0.30, 0.0, 1.0);
    vColor = mix(baseColor, colorCore, highlight);

    float depthFade = 1.0 - smoothstep(1.5, 9.5, -viewPosition.z);
    vAlpha = depthFade * (0.14 + mouseInfluence * 0.38 + 0.05 * sin(uTime * 1.8 + aRandom * 10.0));
  }
`;

const VESPER_FRAGMENT_SHADER = `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core = exp(-dist * dist * 18.0);
    float halo = pow(1.0 - dist * 2.0, 2.2) * 0.38;
    float intensity = core + halo;

    gl_FragColor = vec4(vColor * intensity * vAlpha, 1.0);
  }
`;

// ============================================================================
// 2. PROCEDURAL 3-STATE GEOMETRY GENERATOR (ORB -> GALAXY -> BRAIN CORTEX)
// ============================================================================

function generateVesperGeometries(count: number) {
  const positionsOrb = new Float32Array(count * 3);
  const positionsGalaxy = new Float32Array(count * 3);
  const positionsBrain = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const randoms = new Float32Array(count);
  const colorMix = new Float32Array(count);

  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    randoms[i] = Math.random();
    scales[i] = 0.45 + Math.pow(Math.random(), 2.1) * 1.55;
    colorMix[i] = Math.random();

    // STATE 1: BREATHING FIBONACCI ORB
    const thetaOrb = (2 * Math.PI * i) / goldenRatio;
    const phiOrb = Math.acos(1 - (2 * (i + 0.5)) / count);
    const radiusOrb =
      i % 4 === 0
        ? 0.35 + Math.pow(Math.random(), 0.7) * 1.15
        : 1.48 + (Math.random() - 0.5) * 0.24;

    positionsOrb[i3] = radiusOrb * Math.sin(phiOrb) * Math.cos(thetaOrb);
    positionsOrb[i3 + 1] = radiusOrb * Math.sin(phiOrb) * Math.sin(thetaOrb);
    positionsOrb[i3 + 2] = radiusOrb * Math.cos(phiOrb);

    // STATE 2: 4-ARM LOGARITHMIC SPIRAL GALAXY
    const arms = 4;
    const radiusGal = Math.pow(Math.random(), 1.45) * 3.1;
    const spinAngle = radiusGal * 2.35;
    const branchAngle = ((i % arms) / arms) * Math.PI * 2;

    const spread = 0.28 * (0.25 + radiusGal * 0.45);
    const randomX = Math.pow(Math.random(), 2.5) * (Math.random() < 0.5 ? 1 : -1) * spread;
    const randomY = Math.pow(Math.random(), 3.0) * (Math.random() < 0.5 ? 1 : -1) * (spread * 0.38);
    const randomZ = Math.pow(Math.random(), 2.5) * (Math.random() < 0.5 ? 1 : -1) * spread;

    const gx = Math.cos(branchAngle + spinAngle) * radiusGal + randomX;
    const gy = randomY;
    const gz = Math.sin(branchAngle + spinAngle) * radiusGal + randomZ;

    const tilt = 0.48;
    positionsGalaxy[i3] = gx;
    positionsGalaxy[i3 + 1] = gy * Math.cos(tilt) - gz * Math.sin(tilt);
    positionsGalaxy[i3 + 2] = gy * Math.sin(tilt) + gz * Math.cos(tilt);

    // STATE 3: BIPARTITE THINKING BRAIN CORTEX (GYRI & SULCI)
    const hemisphere = i % 2 === 0 ? 1 : -1;
    const u = Math.random();
    const v = Math.random();
    const thetaBrain = u * 2.0 * Math.PI;
    const phiBrain = Math.acos(2.0 * v - 1.0);

    const shell = 0.82 + 0.18 * Math.pow(Math.random(), 0.4);
    let bx = shell * Math.sin(phiBrain) * Math.cos(thetaBrain);
    let by = shell * Math.sin(phiBrain) * Math.sin(thetaBrain);
    let bz = shell * Math.cos(phiBrain);

    bx = Math.abs(bx) * 0.78 * hemisphere;
    by *= 0.92;
    bz *= 1.28;
    bx += hemisphere * 0.11;
    if (by < 0) by *= 0.72;

    const gyri =
      Math.sin(bx * 7.5 + bz * 4.0) *
      Math.cos(by * 7.5 - bx * 3.0) *
      Math.sin(bz * 6.5 + by * 3.5);
    const foldFactor = 1.0 + gyri * 0.085;

    positionsBrain[i3] = bx * foldFactor;
    positionsBrain[i3 + 1] = by * foldFactor;
    positionsBrain[i3 + 2] = bz * foldFactor;
  }

  return { positionsOrb, positionsGalaxy, positionsBrain, scales, randoms, colorMix };
}

function makePerspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan((fovDeg * Math.PI) / 360.0);
  const nf = 1.0 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function makeModelMatrix(rx: number, ry: number, rz: number, tx: number, ty: number, tz: number): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  return new Float32Array([
    cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz, 0,
    -cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz, 0,
    sy, -sx * cy, cx * cy, 0,
    tx, ty, tz, 1,
  ]);
}

export function VesperStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const displayCanvas = canvasRef.current;
    if (!displayCanvas) return;
    const ctx2d = displayCanvas.getContext("2d");
    if (!ctx2d) return;

    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    }) ||
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      })) as WebGLRenderingContext | null;

    if (!gl) return;

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VESPER_VERTEX_SHADER);
    const fs = compileShader(gl.FRAGMENT_SHADER, VESPER_FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const isMobile = window.innerWidth < 768;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const count = prefersReduced ? 12000 : isMobile ? 22000 : 65000;

    const { positionsOrb, positionsGalaxy, positionsBrain, scales, randoms, colorMix } =
      generateVesperGeometries(count);

    const bindAttr = (name: string, data: Float32Array, size: number) => {
      const loc = gl.getAttribLocation(program, name);
      if (loc < 0) return;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };

    bindAttr("position", positionsOrb, 3);
    bindAttr("aPositionGalaxy", positionsGalaxy, 3);
    bindAttr("aPositionBrain", positionsBrain, 3);
    bindAttr("aScale", scales, 1);
    bindAttr("aRandom", randoms, 1);
    bindAttr("aColorMix", colorMix, 1);

    const uProjectionMatrix = gl.getUniformLocation(program, "uProjectionMatrix");
    const uViewMatrix = gl.getUniformLocation(program, "uViewMatrix");
    const uModelMatrix = gl.getUniformLocation(program, "uModelMatrix");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMorphGalaxy = gl.getUniformLocation(program, "uMorphGalaxy");
    const uMorphBrain = gl.getUniformLocation(program, "uMorphBrain");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMouseVelocity = gl.getUniformLocation(program, "uMouseVelocity");
    const uPixelRatio = gl.getUniformLocation(program, "uPixelRatio");
    const uPulseBoost = gl.getUniformLocation(program, "uPulseBoost");

    const viewMatrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -4.1, 1,
    ]);
    gl.uniformMatrix4fv(uViewMatrix, false, viewMatrix);

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      displayCanvas.width = canvas.width;
      displayCanvas.height = canvas.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      const proj = makePerspective(45, Math.max(0.2, w / Math.max(1, h)), 0.1, 25.0);
      gl.uniformMatrix4fv(uProjectionMatrix, false, proj);
      gl.uniform1f(uPixelRatio, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const mouseTarget = { x: 0, y: 0 };
    const mouseCurrent = { x: 0, y: 0 };
    const prevMouse = { x: 0, y: 0 };
    let mouseVel = 0;
    let scrollTarget = 0;
    let scrollCurrent = 0;
    let pulseTarget = 0;
    let pulseCurrent = 0;

    const onPointerMove = (e: PointerEvent) => {
      mouseTarget.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      mouseTarget.y = -(e.clientY / Math.max(1, window.innerHeight)) * 2 + 1;
    };

    const onScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollTarget = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    };

    const onPulse = () => {
      pulseTarget = 1.0;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("vesper:pulse", onPulse);
    onScroll();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    let animId = 0;
    const start = performance.now();
    let lastTime = start;

    const render = (now: number) => {
      const elapsed = (now - start) * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;

      scrollCurrent += (scrollTarget - scrollCurrent) * Math.min(1, dt * 4.2);
      mouseCurrent.x += (mouseTarget.x - mouseCurrent.x) * Math.min(1, dt * 6.5);
      mouseCurrent.y += (mouseTarget.y - mouseCurrent.y) * Math.min(1, dt * 6.5);

      const dx = mouseCurrent.x - prevMouse.x;
      const dy = mouseCurrent.y - prevMouse.y;
      const instVel = Math.sqrt(dx * dx + dy * dy) / dt;
      prevMouse.x = mouseCurrent.x;
      prevMouse.y = mouseCurrent.y;
      mouseVel += (Math.min(instVel, 2.5) - mouseVel) * Math.min(1, dt * 5.0);

      pulseTarget = Math.max(0, pulseTarget - dt * 1.4);
      pulseCurrent += (pulseTarget - pulseCurrent) * Math.min(1, dt * 8.0);

      const morphGalaxy = Math.max(0, Math.min(1, scrollCurrent / 0.42));
      const morphBrain = Math.max(0, Math.min(1, (scrollCurrent - 0.42) / 0.40));
      const phase3 = Math.max(0, Math.min(1, (scrollCurrent - 0.82) / 0.18));

      const rotY = elapsed * 0.14 + morphGalaxy * Math.PI * 0.55 + morphBrain * Math.PI * 0.7;
      const rotX = morphGalaxy * 0.22 - morphBrain * 0.34 + mouseCurrent.y * 0.14;
      const rotZ = -mouseCurrent.x * 0.14;

      const tx = 0.0;
      const ty = 0.10 - phase3 * 0.42;
      const tz = -phase3 * 0.35;

      const modelMatrix = makeModelMatrix(rotX, rotY, rotZ, tx, ty, tz);

      gl.clearColor(0.0196, 0.0235, 0.0392, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniformMatrix4fv(uModelMatrix, false, modelMatrix);
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uMorphGalaxy, morphGalaxy);
      gl.uniform1f(uMorphBrain, morphBrain);
      gl.uniform2f(uMouse, mouseCurrent.x, mouseCurrent.y);
      gl.uniform1f(uMouseVelocity, mouseVel);
      gl.uniform1f(uPulseBoost, pulseCurrent);

      gl.drawArrays(gl.POINTS, 0, count);
      ctx2d.drawImage(canvas, 0, 0);

      animId = window.requestAnimationFrame(render);
    };

    animId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("vesper:pulse", onPulse);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#05060A]"
    >
      <canvas ref={canvasRef} className="relative z-10 w-full h-full block" />
      <div
        className="absolute inset-0 z-20 opacity-35 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(138, 92, 255, 0.14) 0%, rgba(79, 255, 176, 0.06) 38%, transparent 72%)",
        }}
      />
    </div>
  );
}
export default VesperStage;
