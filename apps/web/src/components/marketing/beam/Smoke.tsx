"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../landing/motion.ts";

/**
 * Volumetric smoke: domain-warped fractal noise in a small WebGL fragment shader, tinted violet and lit where it
 * crosses the beam, kept thin on the left so the headline stays clean. Rendered at about 40% resolution and scaled
 * up (clouds are soft anyway), throttled to roughly 30 fps, paused while the tab is hidden or the hero is off screen,
 * drawn once as a still under reduced motion. If WebGL is unavailable the CSS haze behind it is all there is.
 */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_beam;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(7.1, 3.7); a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;                       // 0 at the top of the hero
  float asp = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * asp, uv.y) * 1.7;
  float t = u_t;

  // one domain-warp pass is enough for the folded, billowing look at this resolution
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.035)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.03, 0.0)));
  float n = fbm(p + 2.8 * q + vec2(1.7, 9.2) + t * 0.02);

  float dx = uv.x - u_beam;
  float right = smoothstep(0.12, 0.72, uv.x);                 // keep the headline side calm
  float nearBeam = exp(-abs(dx) * 2.6);                       // gather around the shaft
  float band = smoothstep(0.0, 0.18, uv.y) * (1.0 - smoothstep(0.62, 0.98, uv.y)); // not at the very top or foot
  float mask = right * (0.5 + 1.15 * nearBeam) * band;

  float dens = smoothstep(0.30, 0.80, n) * mask;
  float core = smoothstep(0.6, 0.95, n);

  vec3 shadow = vec3(0.05, 0.05, 0.16);
  vec3 body = mix(vec3(0.16, 0.14, 0.44), vec3(0.28, 0.27, 0.66), core);
  vec3 lit = vec3(0.50, 0.55, 0.90) * exp(-abs(dx) * 5.5) * 0.30;  // faint beam light on the cloud edges
  vec3 col = mix(shadow, body, smoothstep(0.2, 0.8, n)) + lit * dens;

  float a = clamp(dens * 0.55, 0.0, 0.5);                          // capped so overlapping clouds never blow out to white
  gl_FragColor = vec4(col * a, a);                                  // premultiplied
}
`;

export function Smoke({ beamX = 0.57 }: { beamX?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl || gl.isContextLost()) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uT = gl.getUniformLocation(prog, "u_t");
    const uBeam = gl.getUniformLocation(prog, "u_beam");
    gl.uniform1f(uBeam, beamX);

    // A software rasteriser (SwiftShader, llvmpipe) would starve the page of frames: draw one still instead.
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    const reduced = prefersReducedMotion() || software;
    let raf = 0;
    let visible = true;
    let onScreen = true;
    let last = 0;
    const start = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const s = 0.28;
      canvas.width = Math.max(2, Math.round(r.width * s));
      canvas.height = Math.max(2, Math.round(r.height * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    const draw = (time: number) => {
      gl.uniform1f(uT, time);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    // If frames keep arriving slowly the GPU cannot keep up: stop animating and keep the last frame.
    let slow = 0;
    const frame = (now: number) => {
      if (!visible || !onScreen) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (now - last < 40) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const before = performance.now();
      draw(12 + (now - start) / 1000);
      const cost = performance.now() - before;
      slow = cost > 24 ? slow + 1 : Math.max(0, slow - 1);
      last = now;
      if (slow >= 8) return; // stop the loop; the final frame stays on the canvas
      raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(14);
    });
    ro.observe(canvas);
    if (reduced) {
      draw(14);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) onScreen = e.isIntersecting;
    });
    io.observe(canvas);
    const onVis = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [beamX]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" style={{ mixBlendMode: "screen" }} aria-hidden="true" />;
}
