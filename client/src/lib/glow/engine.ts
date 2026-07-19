/**
 * GlowEngine — an LED-strip light simulation that wraps a DOM element.
 *
 * The engine is a pure ADDITIVE LIGHT LAYER: it renders into a transparent
 * canvas mounted behind the app content (absolute, inset 0, z -1 inside a
 * `relative isolate` container) and adds light over whatever the app draws.
 * Surfaces, backgrounds and the target element's own card styling belong to
 * the app; the engine only contributes photons.
 *
 * Geometry is DOM-driven: every layout change of the target element (resize,
 * autogrow) re-derives the LED strip from its bounding rect + border-radius.
 *
 * Pipeline (per frame): half-res light field -> downsample pyramid -> blur ->
 * upsample-accumulate (bloom) -> full-res composite (grain, LED cores, bloom,
 * exposure, AgX tonemap, dither) -> additive canvas.
 */

import { DEFAULT_GLOW_CONFIG, type GlowConfig, type GlowConfigPatch, mergeConfig } from './config'

type Target = {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

const VERT_SRC = `#version 300 es
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`

const NOISE_GLSL = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i),              hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}`

const SD_RECT_GLSL = `
uniform vec2  u_rectCenter;
uniform vec2  u_rectHalf;
uniform float u_rectRadius;
float sdRect(vec2 p) {
  vec2 q = abs(p - u_rectCenter) - u_rectHalf + vec2(u_rectRadius);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - u_rectRadius;
}`

function sceneSrc(n: number): string {
  return `#version 300 es
precision highp float;
const int N = ${n};
uniform vec2  u_resFull;
uniform float u_scale;
uniform vec2  u_ledPos[N];
uniform vec2  u_ledNormal[N];
uniform float u_bright[N];
uniform vec3  u_ledColor[N];
uniform float u_coreHalf;
uniform float u_dpr;
uniform float u_cull;
uniform float u_kGain;
uniform float u_kPow;
uniform float u_kAbs;
uniform float u_kEmit2; // emitter radius squared, css px
uniform float u_rimStrength;
uniform float u_rimBand;
${SD_RECT_GLSL}
out vec4 outColor;

// glow only — the smooth field, safe at half res; crisp cores live in the
// full-res composite
vec3 ledLight(vec2 p, vec2 ledPos, vec2 n, float brightness, vec3 color) {
  vec2 tangent = vec2(-n.y, n.x);
  float along = clamp(dot(p - ledPos, tangent), -u_coreHalf, u_coreHalf);
  float d = distance(p, ledPos + tangent * along);
  // power law x absorption; the emitter's own radius softens the singularity
  float dc = d / u_dpr;
  float glow = u_kGain * pow(sqrt(dc * dc + u_kEmit2), -u_kPow) * exp(-dc / u_kAbs);
  return color * (brightness * glow);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x * u_scale, u_resFull.y - gl_FragCoord.y * u_scale);

  vec3 light = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec2 dp = p - u_ledPos[i];
    if (dot(dp, dp) > u_cull) continue; // provably invisible skip
    light += ledLight(p, u_ledPos[i], u_ledNormal[i], u_bright[i], u_ledColor[i]);
  }

  // rim: the edge re-emits arriving light (quadrature-rounded crest)
  float d = sdRect(p);
  float dRim = sqrt(max(d, 0.0) * max(d, 0.0) + 9.0 * u_dpr * u_dpr);
  light += light * (u_rimStrength * exp(-dRim / (u_rimBand * u_dpr)));

  // keep interior light out of the bloom pyramid
  light *= smoothstep(-1.0, 1.0, d);

  outColor = vec4(light, 1.0);
}`
}

const COPY_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_resDst;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, gl_FragCoord.xy / u_resDst);
}`

const BLUR_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_resDst;
uniform vec2 u_dir;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resDst;
  vec2 texel = u_dir / u_resDst;
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 sum = texture(u_tex, uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    sum += texture(u_tex, uv + texel * float(i)).rgb * w[i];
    sum += texture(u_tex, uv - texel * float(i)).rgb * w[i];
  }
  outColor = vec4(sum, 1.0);
}`

const COMBINE_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform vec2 u_resDst;
uniform float u_w;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resDst;
  outColor = vec4(texture(u_texA, uv).rgb + u_w * texture(u_texB, uv).rgb, 1.0);
}`

function compositeSrc(n: number): string {
  return `#version 300 es
precision highp float;
const int N = ${n};
uniform sampler2D u_scene;
uniform sampler2D u_bloomTex;
uniform vec2  u_res;
uniform float u_exposure;
uniform float u_grainOn;
uniform float u_grainDepth;
uniform float u_grainScale;
uniform float u_grainSparkle;
uniform float u_bloomWeight;
uniform float u_dpr;
uniform vec2  u_ledPos[N];
uniform vec2  u_ledNormal[N];
uniform float u_bright[N];
uniform vec3  u_ledColor[N];
uniform float u_coreHalf;
${SD_RECT_GLSL}
${NOISE_GLSL}
out vec4 outColor;

// AgX tonemap (Blender-era filmic; softer hue handling than ACES)
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
       - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 val) {
  const mat3 inset = mat3(
    0.842479062253094,  0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772,  0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(
     1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433,  1.15107367264116);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  val = inset * val;
  val = clamp(log2(val), minEv, maxEv);
  val = (val - minEv) / (maxEv - minEv);
  val = agxContrast(val);
  val = outset * val;
  return pow(max(val, 0.0), vec3(2.2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float sd = sdRect(p);

  vec3 light = texture(u_scene, uv).rgb;

  // grain at full res: soft weave + per-pixel sparkle, css-px sized
  float g = mix(
    vnoise((p - u_rectCenter) / (u_grainScale * u_dpr)),
    hash12(floor(p / u_dpr)),
    u_grainSparkle
  );
  light *= mix(1.0, mix(1.0, 1.0 - u_grainDepth, g), u_grainOn);

  // LED cores at full res, gated to a thin band along the strip
  if (abs(sd) < 8.0 * u_dpr) {
    float cc = u_coreHalf + 8.0 * u_dpr;
    for (int i = 0; i < N; i++) {
      vec2 dp = p - u_ledPos[i];
      if (dot(dp, dp) > cc * cc) continue;
      vec2 n = u_ledNormal[i];
      vec2 tangent = vec2(-n.y, n.x);
      float along = clamp(dot(dp, tangent), -u_coreHalf, u_coreHalf);
      float d = distance(p, u_ledPos[i] + tangent * along);
      float core = smoothstep(2.5, 1.0, d);
      light += mix(u_ledColor[i], vec3(1.0), 0.35) * core * u_bright[i];
    }
  }

  light += u_bloomWeight * texture(u_bloomTex, uv).rgb;
  light *= u_exposure;

  vec3 finalColor = pow(agx(light), vec3(1.0 / 2.2));

  // suppress light over the target element (its own surface owns that area)
  finalColor *= smoothstep(-1.0, 1.0, sd);

  // dither, gated by luminance so pure darkness stays untouched (the canvas
  // is additive — unconditional dither would sprinkle the whole page)
  float lum = dot(finalColor, vec3(0.2126, 0.7152, 0.0722));
  float n1 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float n2 = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 17.13, vec2(0.00583715, 0.06711056))));
  finalColor += (n1 + n2 - 1.0) / 255.0 * min(1.0, lum * 40.0);

  // premultiplied compositing: alpha = max channel keeps the premultiplied
  // constraint valid (rgb <= a) while staying near-additive over a dark page.
  // (alpha 0 would be pure additive but is spec-undefined and some browsers
  // clamp it to invisible.)
  float a = clamp(max(finalColor.r, max(finalColor.g, finalColor.b)), 0.0, 1.0);
  outColor = vec4(finalColor, a);
}`
}

export class GlowEngine {
  private config: GlowConfig
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private container: HTMLElement | null = null
  private target: HTMLElement | null = null

  private programs: {
    scene: WebGLProgram
    copy: WebGLProgram
    blur: WebGLProgram
    combine: WebGLProgram
    composite: WebGLProgram
  } | null = null
  private locCache = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>()
  private chain: Target[] = []
  private pings: Target[] = []
  private lightFull: Target | null = null

  private ledPos!: Float32Array
  private ledNormal!: Float32Array
  private ledColor!: Float32Array
  private brightness!: Float32Array
  private waveState: { center: number; vel: number; width: number; strength: number }[] = []

  private rect = { cx: 0, cy: 0, hw: 0, hh: 0, r: 0 }
  private rectDirty = true
  private reducedMotion = false
  private dissipation: { t0: number; duration: number } | null = null
  private dissipateTimer: ReturnType<typeof setTimeout> | null = null
  private frozenWidth: number | null = null
  private focusEase = 0
  private burstState: { t0: number; origin: number } | null = null
  private lastT = 0
  private lastRender = 0
  private raf = 0
  private running = false
  private visible = true
  private inView = true

  private resizeObserver: ResizeObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null
  private cleanups: (() => void)[] = []

  constructor(patch: GlowConfigPatch = {}) {
    this.config = mergeConfig(DEFAULT_GLOW_CONFIG, patch)
    this.allocLedArrays()
  }

  /** Mount behind `target`, rendering into a canvas appended to `container`.
   *  The container should be `position: relative; isolation: isolate` (the
   *  canvas is absolute inset-0 z--1 inside it). */
  attach(target: HTMLElement, container: HTMLElement): void {
    this.detach()
    this.target = target
    this.container = container

    const canvas = document.createElement('canvas')
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none'
    container.appendChild(canvas)
    this.canvas = canvas

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      // no WebGL2/float — the app simply has no glow; never break the input
      console.warn('[glow] WebGL2 float rendering unavailable; glow disabled')
      canvas.remove()
      this.canvas = null
      return
    }
    this.gl = gl

    this.buildPrograms()
    this.resizeCanvas()

    this.resizeObserver = new ResizeObserver(() => {
      this.rectDirty = true
      this.resizeCanvasIfNeeded()
    })
    this.resizeObserver.observe(target)
    this.resizeObserver.observe(container)

    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inView = entries[0]?.isIntersecting ?? true
    })
    this.intersectionObserver.observe(target)

    const onVisibility = () => {
      this.visible = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.running = true
    this.raf = requestAnimationFrame(this.frame)
  }

  detach(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.dissipateTimer) clearTimeout(this.dissipateTimer)
    this.dissipateTimer = null
    this.dissipation = null
    this.frozenWidth = null
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    for (const fn of this.cleanups) fn()
    this.cleanups = []
    this.deleteTargets()
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas?.remove()
    this.canvas = null
    this.gl = null
    this.programs = null
    this.locCache.clear()
    this.target = null
    this.container = null
  }

  private deleteTargets(): void {
    const gl = this.gl
    if (!gl) return
    for (const t of [...this.chain, ...this.pings, ...(this.lightFull ? [this.lightFull] : [])]) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    this.chain = []
    this.pings = []
    this.lightFull = null
  }

  destroy(): void {
    this.detach()
  }

  get isDissipating(): boolean {
    return this.dissipation !== null
  }

  /** Outlive the owning route: reparent the canvas to <body> at its current
   *  viewport rect, freeze DOM-derived geometry, decay all light to zero,
   *  then self-destroy. Call before the container unmounts. */
  dissipate(durationMs = 650): void {
    if (!this.canvas || !this.gl || !this.container || this.reducedMotion) {
      this.destroy()
      return
    }
    const box = this.container.getBoundingClientRect()
    this.frozenWidth = box.width || 1
    this.canvas.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:50;pointer-events:none`
    document.body.appendChild(this.canvas)
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.rectDirty = false
    this.dissipation = { t0: this.lastT, duration: durationMs / 1000 }
    this.dissipateTimer = setTimeout(() => this.destroy(), durationMs + 100)
  }

  /** Update any knobs at runtime. `ledCount` triggers a shader rebuild. */
  set(patch: GlowConfigPatch): void {
    const prevN = this.config.ledCount
    this.config = mergeConfig(this.config, patch)
    if (patch.waves) this.waveState = []
    if (this.config.ledCount !== prevN) {
      this.allocLedArrays()
      if (this.gl) this.buildPrograms()
      this.rectDirty = true
    }
  }

  getConfig(): GlowConfig {
    return this.config
  }

  /** The submit pulse: a light front expanding from the bottom edge. */
  burst(): void {
    const ew = this.rect.hw * 2
    const eh = this.rect.hh * 2
    const perimeter = 2 * (ew + eh)
    const origin = ((ew + eh + ew / 2) / perimeter) * this.config.ledCount
    this.burstState = { t0: this.lastT, origin }
  }

  // --- internals --------------------------------------------------------------

  private allocLedArrays(): void {
    const n = this.config.ledCount
    this.ledPos = new Float32Array(n * 2)
    this.ledNormal = new Float32Array(n * 2)
    this.ledColor = new Float32Array(n * 3)
    this.brightness = new Float32Array(n)
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl!
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed')
    }
    return shader
  }

  private buildPrograms(): void {
    const gl = this.gl!
    const vert = this.compile(gl.VERTEX_SHADER, VERT_SRC)
    const make = (fragSrc: string) => {
      const prog = gl.createProgram()!
      gl.attachShader(prog, vert)
      gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fragSrc))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed')
      }
      return prog
    }
    const n = this.config.ledCount
    this.locCache.clear()
    this.programs = {
      scene: make(sceneSrc(n)),
      copy: make(COPY_SRC),
      blur: make(BLUR_SRC),
      combine: make(COMBINE_SRC),
      composite: make(compositeSrc(n)),
    }
  }

  private loc(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.locCache.get(prog)
    if (!m) {
      m = {}
      this.locCache.set(prog, m)
    }
    const cached = m[name]
    if (cached !== undefined) return cached
    const location = this.gl!.getUniformLocation(prog, name)
    m[name] = location
    return location
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl!
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fbo, w, h }
  }

  private resizeCanvas(): void {
    const { canvas, container, gl } = this
    if (!canvas || !container || !gl) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const box = container.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(box.width * dpr))
    canvas.height = Math.max(1, Math.round(box.height * dpr))

    this.deleteTargets()
    this.lightFull =
      this.config.quality === 'high' ? this.makeTarget(canvas.width, canvas.height) : null
    this.chain = []
    this.pings = []
    for (let i = 0; i < 6; i++) {
      const w = Math.max(1, canvas.width >> (i + 1))
      const h = Math.max(1, canvas.height >> (i + 1))
      this.chain.push(this.makeTarget(w, h))
      this.pings.push(this.makeTarget(w, h))
    }
    this.rectDirty = true
  }

  private resizeCanvasIfNeeded(): void {
    const { canvas, container } = this
    if (!canvas || !container) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const box = container.getBoundingClientRect()
    if (
      Math.abs(canvas.width - box.width * dpr) > 1 ||
      Math.abs(canvas.height - box.height * dpr) > 1
    ) {
      this.resizeCanvas()
    }
  }

  private readRectFromDom(): void {
    const { canvas, container, target } = this
    if (!canvas || !container || !target) return
    const dpr = canvas.width / container.getBoundingClientRect().width
    const c = container.getBoundingClientRect()
    const b = target.getBoundingClientRect()
    this.rect.cx = (b.left - c.left + b.width / 2) * dpr
    this.rect.cy = (b.top - c.top + b.height / 2) * dpr
    this.rect.hw = (b.width / 2) * dpr
    this.rect.hh = (b.height / 2) * dpr
    this.rect.r = (Number.parseFloat(getComputedStyle(target).borderRadius) || 0) * dpr
  }

  private layoutLeds(): void {
    const { rect } = this
    const n = this.config.ledCount
    const r = Math.min(rect.r, Math.min(rect.hw, rect.hh))
    const w = rect.hw * 2
    const h = rect.hh * 2
    const left = rect.cx - rect.hw
    const top = rect.cy - rect.hh
    const ws = w - 2 * r
    const hs = h - 2 * r
    const arc = (Math.PI * r) / 2
    const HALF_PI = Math.PI / 2
    type Seg =
      | { len: number; sx: number; sy: number; dx: number; dy: number; nx: number; ny: number }
      | { len: number; cx: number; cy: number; a0: number }
    const segs: Seg[] = [
      { len: ws, sx: left + r, sy: top, dx: 1, dy: 0, nx: 0, ny: -1 },
      { len: arc, cx: left + w - r, cy: top + r, a0: -HALF_PI },
      { len: hs, sx: left + w, sy: top + r, dx: 0, dy: 1, nx: 1, ny: 0 },
      { len: arc, cx: left + w - r, cy: top + h - r, a0: 0 },
      { len: ws, sx: left + w - r, sy: top + h, dx: -1, dy: 0, nx: 0, ny: 1 },
      { len: arc, cx: left + r, cy: top + h - r, a0: HALF_PI },
      { len: hs, sx: left, sy: top + h - r, dx: 0, dy: -1, nx: -1, ny: 0 },
      { len: arc, cx: left + r, cy: top + r, a0: Math.PI },
    ]
    const perimeter = segs.reduce((sum, sg) => sum + sg.len, 0)
    for (let k = 0; k < n; k++) {
      let s = ((k + 0.5) / n) * perimeter
      let seg = segs[0]!
      for (const sg of segs) {
        if (s < sg.len) {
          seg = sg
          break
        }
        s -= sg.len
      }
      let x: number
      let y: number
      let nx: number
      let ny: number
      if ('dx' in seg) {
        x = seg.sx + seg.dx * s
        y = seg.sy + seg.dy * s
        nx = seg.nx
        ny = seg.ny
      } else {
        const a = seg.a0 + (s / seg.len) * HALF_PI
        nx = Math.cos(a)
        ny = Math.sin(a)
        x = seg.cx + r * nx
        y = seg.cy + r * ny
      }
      this.ledPos[2 * k] = x
      this.ledPos[2 * k + 1] = y
      this.ledNormal[2 * k] = nx
      this.ledNormal[2 * k + 1] = ny
    }
  }

  private computeLedColors(): void {
    const { rect, focusEase } = this
    const n = this.config.ledCount
    const colorize = this.config.focusColorize ? focusEase : 1
    const ew = rect.hw * 2
    const eh = rect.hh * 2
    const perimeter = 2 * (ew + eh)
    const starts = [0, ew, ew + eh, ew + eh + ew]
    const lens = [ew, eh, ew, eh]
    const ringDist = (a: number, b: number) => {
      const d = Math.abs(a - b) % n
      return Math.min(d, n - d)
    }
    for (let k = 0; k < n; k++) {
      let r = 0
      let g = 0
      let b = 0
      let wsum = 0
      for (let e = 0; e < 4; e++) {
        const start = starts[e]!
        const len = lens[e]!
        const lobe = this.config.lobes[e as 0 | 1 | 2 | 3]
        const mid = ((start + len / 2) / perimeter) * n
        const sigma = (len / perimeter) * n * 0.55
        const d = ringDist(k, mid) / sigma
        const weight = Math.exp(-d * d * 2.0)
        r += lobe[0] * weight
        g += lobe[1] * weight
        b += lobe[2] * weight
        wsum += weight
      }
      this.ledColor[3 * k] = 1 + (r / wsum - 1) * colorize
      this.ledColor[3 * k + 1] = 1 + (g / wsum - 1) * colorize
      this.ledColor[3 * k + 2] = 1 + (b / wsum - 1) * colorize
    }
  }

  private animate(tSec: number): void {
    const n = this.config.ledCount
    const dt = Math.min(tSec - this.lastT, 0.1)
    this.lastT = tSec

    if (this.waveState.length !== this.config.waves.length) {
      this.waveState = this.config.waves.map((w) => ({ ...w }))
    }
    // live-sync tunables while preserving traveling positions
    for (let i = 0; i < this.waveState.length; i++) {
      const src = this.config.waves[i]
      const st = this.waveState[i]
      if (!src || !st) continue
      st.vel = src.vel
      st.width = src.width
      st.strength = src.strength
      st.center = (((st.center + st.vel * dt) % n) + n) % n
    }

    // Freeze focus color during dissipation — the target is unmounting and
    // would read as unfocused, snapping the light back to white mid-fade.
    if (!this.dissipation) {
      const focused = this.target ? this.target.contains(document.activeElement) : false
      this.focusEase += ((focused ? 1 : 0) - this.focusEase) * (1 - Math.exp(-dt / 0.25))
    }

    const ringDist = (a: number, b: number) => {
      const d = Math.abs(a - b) % n
      return Math.min(d, n - d)
    }
    for (let k = 0; k < n; k++) {
      let b = this.config.idleBase
      for (const wv of this.waveState) {
        const d = ringDist(k, wv.center)
        b += wv.strength * Math.exp(-(d * d) / (wv.width * wv.width))
      }
      if (this.burstState) {
        const fromOrigin = ringDist(k, this.burstState.origin)
        const since = tSec - this.burstState.t0 - fromOrigin / 84
        if (since > 0) b += 2.5 * Math.exp(-since * 3.0)
      }
      this.brightness[k] = b
    }
    if (this.burstState && tSec - this.burstState.t0 > n / 2 / 84 + 2.5) this.burstState = null
  }

  private drawTo(target: Target | null): void {
    const gl = this.gl!
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(
      0,
      0,
      target ? target.w : this.canvas!.width,
      target ? target.h : this.canvas!.height
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    const gl = this.gl!
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  private frame = (tMs: number): void => {
    if (!this.running) return
    // Reduced motion: render the static idle field once, then stop the loop.
    if (!this.reducedMotion) this.raf = requestAnimationFrame(this.frame)
    else this.running = false

    if (!this.gl || !this.canvas || !this.visible || !this.inView) return
    const minGap = 1000 / this.config.maxFps - 1.2
    if (tMs - this.lastRender < minGap) return
    this.lastRender = tMs

    const gl = this.gl
    const cfg = this.config
    const programs = this.programs
    if (!programs) return

    this.animate(tMs / 1000)
    if (this.rectDirty) {
      this.readRectFromDom()
      this.layoutLeds()
      this.rectDirty = false
    }
    this.computeLedColors()

    const containerWidth = this.frozenWidth ?? (this.container!.getBoundingClientRect().width || 1)
    const dprScale = this.canvas.width / containerWidth
    const spacing = (2 * (this.rect.hw * 2 + this.rect.hh * 2)) / cfg.ledCount
    const coreHalf = Math.max(0, spacing / 2 - 0.5)
    const lightTarget = cfg.quality === 'high' && this.lightFull ? this.lightFull : this.chain[0]!

    // 1. light field
    const scene = programs.scene
    gl.useProgram(scene)
    gl.uniform2f(this.loc(scene, 'u_resFull'), this.canvas.width, this.canvas.height)
    gl.uniform1f(this.loc(scene, 'u_scale'), this.canvas.width / lightTarget.w)
    gl.uniform2fv(this.loc(scene, 'u_ledPos'), this.ledPos)
    gl.uniform2fv(this.loc(scene, 'u_ledNormal'), this.ledNormal)
    gl.uniform1fv(this.loc(scene, 'u_bright'), this.brightness)
    gl.uniform3fv(this.loc(scene, 'u_ledColor'), this.ledColor)
    gl.uniform1f(this.loc(scene, 'u_coreHalf'), coreHalf)
    gl.uniform1f(this.loc(scene, 'u_dpr'), dprScale)
    const cullPx = (cfg.kernel.absorptionPx * 3.5 + 100) * dprScale
    gl.uniform1f(this.loc(scene, 'u_cull'), cullPx * cullPx)
    gl.uniform1f(this.loc(scene, 'u_kGain'), cfg.kernel.gain)
    gl.uniform1f(this.loc(scene, 'u_kPow'), cfg.kernel.falloffPower)
    gl.uniform1f(this.loc(scene, 'u_kAbs'), cfg.kernel.absorptionPx)
    gl.uniform1f(
      this.loc(scene, 'u_kEmit2'),
      cfg.kernel.emitterRadiusPx * cfg.kernel.emitterRadiusPx
    )
    gl.uniform1f(this.loc(scene, 'u_rimStrength'), cfg.rim.enabled ? cfg.rim.strength : 0)
    gl.uniform1f(this.loc(scene, 'u_rimBand'), cfg.rim.bandPx)
    gl.uniform2f(this.loc(scene, 'u_rectCenter'), this.rect.cx, this.rect.cy)
    gl.uniform2f(this.loc(scene, 'u_rectHalf'), this.rect.hw, this.rect.hh)
    gl.uniform1f(this.loc(scene, 'u_rectRadius'), this.rect.r)
    this.drawTo(lightTarget)

    // 2. downsample pyramid
    const copy = programs.copy
    gl.useProgram(copy)
    gl.uniform1i(this.loc(copy, 'u_tex'), 0)
    let src: Target = lightTarget
    const levels = lightTarget === this.chain[0] ? this.chain.slice(1) : this.chain
    for (const level of levels) {
      gl.uniform2f(this.loc(copy, 'u_resDst'), level.w, level.h)
      this.bindTex(0, src.tex)
      this.drawTo(level)
      src = level
    }

    // 3. blur three scales
    const blur = programs.blur
    gl.useProgram(blur)
    gl.uniform1i(this.loc(blur, 'u_tex'), 0)
    for (const i of [1, 3, 4]) {
      const level = this.chain[i]!
      const ping = this.pings[i]!
      gl.uniform2f(this.loc(blur, 'u_resDst'), level.w, level.h)
      gl.uniform2f(this.loc(blur, 'u_dir'), 1, 0)
      this.bindTex(0, level.tex)
      this.drawTo(ping)
      gl.uniform2f(this.loc(blur, 'u_dir'), 0, 1)
      this.bindTex(0, ping.tex)
      this.drawTo(level)
    }

    // 4. climb back up (bloom accumulation)
    const combine = programs.combine
    gl.useProgram(combine)
    gl.uniform1i(this.loc(combine, 'u_texA'), 0)
    gl.uniform1i(this.loc(combine, 'u_texB'), 1)
    gl.uniform1f(this.loc(combine, 'u_w'), 0.7)
    let acc = this.chain[4]!
    for (let i = 3; i >= 1; i--) {
      const level = this.chain[i]!
      const ping = this.pings[i]!
      gl.uniform2f(this.loc(combine, 'u_resDst'), level.w, level.h)
      this.bindTex(0, level.tex)
      this.bindTex(1, acc.tex)
      this.drawTo(ping)
      acc = ping
    }

    // 5. composite (full res, additive over the page)
    const composite = programs.composite
    gl.useProgram(composite)
    gl.uniform2f(this.loc(composite, 'u_res'), this.canvas.width, this.canvas.height)
    const fade = this.dissipation
      ? Math.max(0, 1 - (tMs / 1000 - this.dissipation.t0) / this.dissipation.duration) ** 1.5
      : 1
    gl.uniform1f(this.loc(composite, 'u_exposure'), cfg.exposure * fade)
    gl.uniform1f(this.loc(composite, 'u_grainOn'), cfg.grain.enabled ? 1 : 0)
    gl.uniform1f(this.loc(composite, 'u_grainDepth'), cfg.grain.depth)
    gl.uniform1f(this.loc(composite, 'u_grainScale'), cfg.grain.scalePx)
    gl.uniform1f(this.loc(composite, 'u_grainSparkle'), cfg.grain.sparkle)
    gl.uniform1f(this.loc(composite, 'u_bloomWeight'), cfg.bloom.enabled ? cfg.bloom.weight : 0)
    gl.uniform1f(this.loc(composite, 'u_dpr'), dprScale)
    gl.uniform2fv(this.loc(composite, 'u_ledPos'), this.ledPos)
    gl.uniform2fv(this.loc(composite, 'u_ledNormal'), this.ledNormal)
    gl.uniform1fv(this.loc(composite, 'u_bright'), this.brightness)
    gl.uniform3fv(this.loc(composite, 'u_ledColor'), this.ledColor)
    gl.uniform1f(this.loc(composite, 'u_coreHalf'), coreHalf)
    gl.uniform2f(this.loc(composite, 'u_rectCenter'), this.rect.cx, this.rect.cy)
    gl.uniform2f(this.loc(composite, 'u_rectHalf'), this.rect.hw, this.rect.hh)
    gl.uniform1f(this.loc(composite, 'u_rectRadius'), this.rect.r)
    gl.uniform1i(this.loc(composite, 'u_scene'), 0)
    gl.uniform1i(this.loc(composite, 'u_bloomTex'), 1)
    this.bindTex(0, lightTarget.tex)
    this.bindTex(1, acc.tex)
    this.drawTo(null)
  }
}
