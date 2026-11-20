// @ts-nocheck —— 必须放在文件第一行才生效。
// 下面这一大段是第三方 JS（用户提供的 MouseSpark）**原样搬运**，不做类型检查：
// 它本来是给桌面程序内嵌用的单文件脚本，硬加类型反而容易改出行为差异。
// 正确性靠行为测试保证：scripts/audit-mouse-effect.mjs
/* eslint-disable */
/**
 * 鼠标点击特效（MouseSpark）
 *
 * 来源：用户提供的一份独立单文件版（原版是给桌面程序内嵌用的，自带 window.* 桥接接口）。
 * 这里**原样保留算法**，只做四处适配：
 *   1. 包进 install()，什么时候装上/启用由编辑器控制（原版是页面加载就跑）
 *   2. 画布自己创建（原版从 HTML 里 getElementById("sparkCanvas") 取）
 *   3. 加 paused 开关：关掉特效时连 rAF 循环也不干活（省 CPU）
 *   4. 加 trailHz（拖尾刷新率）：原版每帧采样，现在可按 Hz 节流
 *
 * 效果构成（原版注释里的说法）：中间的填充 filledCircle + 外围弧线 ring = 一次点击的 wave。
 * 画布是 pointer-events:none 的全屏透明层，永远不挡鼠标操作。
 */

export type MouseEffect = 'off' | 'click' | 'clickTrail'

let installed = false
let canvasEl: HTMLCanvasElement | null = null

interface SparkLike {
  paused: boolean
  trail: unknown[]
  sparks: unknown[]
  waves: unknown[]
  color?: string
  ringsEndColor?: number[]
  scale?: number
  trailHz?: number
}

const w = window as unknown as {
  spark?: SparkLike
  setInputContext?: (mode: string, alwaysTrail: boolean) => void
  updateColor?: (rgb: string) => void
  updateEffectSettings?: (scale: number, opacity: number, trailSpeed: number, clickSpeed: number) => void
}

/** 首次启用时把特效装进页面（只装一次） */
function install(): void {
  if (installed) return
  installed = true

  // 样式由模块自己注入：这样纯净版构建里连一条 #sparkCanvas 的 CSS 都不会残留
  const style = document.createElement('style')
  style.textContent = [
    '#sparkCanvas{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999}',
    '@media print{#sparkCanvas{display:none}}',
  ].join('')
  document.head.appendChild(style)

  canvasEl = document.createElement('canvas')
  canvasEl.id = 'sparkCanvas'
  canvasEl.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvasEl)


      // re: 动画常量集中定义，避免每帧 new 对象
      const FILLED_CIRCLE_CFG = { rAddRate: 26, maxLife: 16 };
      const RINGS_ANIM_CFG = {
          rsList: [0, 0.08, 0.1],
          rRoundRateList: [0, 1, 1.5, 2],
          len: 1.1 * Math.PI,
          maxLife: 23,
          segNum: 10,
          minW: 0.4,
          maxW: 3.3,
          lenStopAddPoint: 0.1,
          lenStartDimPoint: 0.4,
      };
      const CREATE_CLICK_CFG = {
          rings: {
              rsList: [0, 0.03, 0.06],
              rRoundRateList: [0, 1, 1.5, 2],
              len: 1.1 * Math.PI,
          },
          sparksCount: 4,
      };

      function ringsEndColorFromRgb(rgbString) {
          return rgbString.split(',').map(Number).map((n) => (n + 255 * 2) / 3);
      }

      /** 两个颜色之间按 t(0–1) 混出 "r,g,b"；没设颜色二就返回颜色一（单色） */
      function mixRgb(a, b, t) {
          if (!b) return a;
          const pa = a.split(',').map(Number);
          const pb = b.split(',').map(Number);
          const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
          return pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * k)).join(',');
      }

      /** HSL → "r,g,b"（彩虹模式用：色相绕一圈就是彩虹） */
      function hslRgb(h, s, l) {
          const sn = s / 100, ln = l / 100;
          const c = (1 - Math.abs(2 * ln - 1)) * sn;
          const hp = (((h % 360) + 360) % 360) / 60;
          const x = c * (1 - Math.abs((hp % 2) - 1));
          const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
              : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
          const m = ln - c / 2;
          return [r1, g1, b1].map((v) => Math.round((v + m) * 255)).join(',');
      }

      class MouseSpark {
          constructor(opts = {}) {
              this.color = opts.color || '45,175,255';
              this.color2 = opts.color2 || '';
              this.rainbow = !!opts.rainbow;
              this.rainbowPhase = 0; // 彩虹模式的色相起点（每帧按时间推进）
              this.scale = opts.scale || 1.5;
              this.opacity = opts.opacity || 1.0;
              this.trailSpeed = opts.trailSpeed != null ? opts.trailSpeed : (opts.speed || 1.0);
              this.clickSpeed = opts.clickSpeed != null ? opts.clickSpeed : (opts.speed || 1.0);
              this.maxTrail = opts.maxTrail || 16;

              this.sparksPool = [];
              this.wavesPool = [];

              this.waves = [];
              this.sparks = [];
              this.trail = [];
              this.isDown = false;
              this.lastPos = null;
              this.baseFrameMs = 1000 / 60;
              this.maxDeltaMs = 100;
              this.lastFrameTime = performance.now();
              this.dpr = 1;
              this.cssWidth = 1;
              this.cssHeight = 1;
              this.previousDirtyRects = [];
              this.forceFullRedraw = true;
              this.paused = false; // 新增：暂停时不做任何绘制
              this.trailHz = 60;   // 新增：拖尾刷新率（Hz），60 = 每帧都采样
              this.lastTrailAt = 0; // 新增：上次采样拖尾的时间
              /* 特效锚点相对鼠标坐标的偏移（0 = 就画在鼠标坐标上）。
                 开了自定义指针之后由 setEffectAnchor 设成"箭头尖 − 光标热点"，
                 这样圆圈落在箭头尖底下。 */
              this.anchorDX = 0;
              this.anchorDY = 0;


              this.ringsStartColor = [250, 252, 252];
              //this.ringsEndColor = [200, 250, 255];
              this.ringsEndColor = ringsEndColorFromRgb(this.color2 || this.color);

              this.initCanvas();
              this.bindEvents();
              requestAnimationFrame((now) => this.animationLoops(now));
          }

          /** 按 t(0–1) 取当前该用的颜色：
           *  - 彩虹模式：色相顺着轨迹流动 + 随时间缓慢漂移（"彩虹"感）
           *  - 设了颜色二：两个颜色之间过渡
           *  - 都没有：单色
           */
          rgbAt(t) {
              const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
              if (this.rainbow) {
                  const base = this.rainbowPhase + k * 170; // 沿轨迹铺开一段色相
                  return hslRgb(base, 85, 58);
              }
              return mixRgb(this.color, this.color2, k);
          }

          bindEvents() {
              /* 坐标统一在这里取：
                 默认就是鼠标坐标；开了自定义指针之后加上 anchorDX/DY，
                 让**整套特效（点击云 + 拖尾）都跟着箭头尖走**。
                 只在事件入口加这一次 —— 散在各处加会漏掉拖尾，也会重复偏移。 */
              const getPos = (e) => ({
                  x: e.clientX + (this.anchorDX || 0),
                  y: e.clientY + (this.anchorDY || 0),
              });
              const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

              window.addEventListener("mousedown", (e) => {
                  this.isDown = true;
                  this.lastPos = getPos(e);
                  this.createEffects(this.lastPos.x, this.lastPos.y);
              });

              window.addEventListener("mousemove", (e) => {
                  if (!this.isDown && !window.effectiveAlwaysTrail) return;
                  const p = getPos(e);
                  const prev = this.lastPos;
                  if (!prev) {
                      this.lastPos = p;
                      return;
                  }
                  if (dist(p, prev) > 2) {
                      // 新增：拖尾刷新率节流
                      if (this.trailHz < 240) {
                          const nowMs = performance.now();
                          const gap = 1000 / Math.max(1, this.trailHz);
                          if (nowMs - this.lastTrailAt < gap) {
                              this.lastPos = p;
                              return;
                          }
                          this.lastTrailAt = nowMs;
                      }
                      this.trail.push({ x: p.x, y: p.y, life: 1 });
                      if (this.trail.length > this.maxTrail) this.trail.shift();

                      if (Math.random() < 0.3) {
                          const a = Math.random() * Math.PI * 2;
                          const speedAdjust = this.scale / 1.5;
                          this.sparks.push({
                              x: p.x + Math.cos(a) * 10 * this.scale,
                              y: p.y + Math.sin(a) * 10 * this.scale,
                              vx: Math.cos(a) * 1.3 * speedAdjust,
                              vy: Math.sin(a) * 1.3 * speedAdjust,
                              rot: Math.random() * Math.PI * 2,
                              rs: 0.16,
                              s: 9 * this.scale,
                              a: 0.7,
                              f: 0.95,
                              fromClick: false,
                          });
                      }
                  }
                  this.lastPos = p;
              });

              window.addEventListener("mouseup", () => {
                  this.isDown = false;
              });
          }

          // 初始化画布 可见层 + 离屏缓冲
          // lighter合成后贴回，减轻主画布混合开销
          initCanvas() {
              // 主画布
              this.mainCanvas = document.getElementById("sparkCanvas");
              this.mainCtx = this.mainCanvas.getContext("2d");

              // 缓冲画布
              this.bufferCanvas = document.createElement("canvas");
              this.bufferCtx = this.bufferCanvas.getContext("2d");

              this.resize();

              // 监听窗口缩放
              window.addEventListener("resize", () => this.resize());
          }

          alpha(value) {
              return Math.max(0, Math.min(1, value * this.opacity));
          }

          resize() {
              const dpr = window.devicePixelRatio || 1;
              const cssWidth = Math.max(1, window.innerWidth);
              const cssHeight = Math.max(1, window.innerHeight);
              const w = Math.max(1, Math.floor(cssWidth * dpr));
              const h = Math.max(1, Math.floor(cssHeight * dpr));

              this.dpr = dpr;
              this.cssWidth = cssWidth;
              this.cssHeight = cssHeight;
              this.mainCanvas.width = w;
              this.mainCanvas.height = h;
              this.bufferCanvas.width = w;
              this.bufferCanvas.height = h;
              this.previousDirtyRects = [];
              this.forceFullRedraw = true;

              this.bufferCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }

          // 中间的填充叫 filledCircle
          // 外围的弧线叫 ring
          // 它们合起来叫 wave


          // -=创建点击效果=-
          createEffects(x, y) {
              const rc = CREATE_CLICK_CFG.rings;
              const sparksCount = CREATE_CLICK_CFG.sparksCount;

              let wave;
              if (this.wavesPool.length > 0) {
                  wave = this.wavesPool.pop();
              } else {
                  wave = {};
              }
              if (!wave.ring) wave.ring = { segs: [] };

              // 赋值
              wave.x = x;
              wave.y = y;
              wave.r = 0;
              wave.life = 0;
              wave.ring.ang = Math.random() * Math.PI * 2;
              wave.ring.rs = rc.rsList[Math.floor(Math.random() * rc.rsList.length)];
              wave.ring.segs[0] = {
                  off: 0,
                  len: rc.len,
                  rRoundRate: rc.rRoundRateList[Math.floor(Math.random() * rc.rRoundRateList.length)],
              };
              wave.ring.segs[1] = {
                  off: (Math.random() * 3 - 1.5) * Math.PI,
                  len: rc.len,
                  rRoundRate: rc.rRoundRateList[Math.floor(Math.random() * rc.rRoundRateList.length)],
              };

              // 进入循环
              this.waves.push(wave);

              const speedAdjust = this.scale / 1.5;
              for (let i = 0; i < sparksCount; i++) {
                  const a = Math.random() * Math.PI * 2;
                  const speed = (4.8 + Math.random() * 2) * speedAdjust;

                  // 创建
                  let spark;
                  if (this.sparksPool.length > 0) {
                      spark = this.sparksPool.pop();
                  } else {
                      spark = {};
                  }

                  // 赋值
                  spark.x = x;
                  spark.y = y;
                  spark.vx = Math.cos(a) * speed;
                  spark.vy = Math.sin(a) * speed;
                  spark.rot = Math.random() * Math.PI * 2;
                  spark.rs = (Math.random() - 0.5) * 0.28;
                  spark.s = (4 + Math.random() * 3) * this.scale;
                  spark.a = 1;
                  spark.f = 0.9;
                  spark.fromClick = true;
                  this.sparks.push(spark);
              }
          }

          _clearBuffer(rect) {
              const ctx = this.bufferCtx;
              if (rect) {
                  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
              } else {
                  ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
              }
          }

          _clearBufferRects(rects) {
              if (!rects || rects.length === 0) {
                  return;
              }

              for (const rect of rects) {
                  this._clearBuffer(rect);
              }
          }

          _updateTrail(frameScale) {
              const ctx = this.bufferCtx;
              const n = this.trail.length;
              let baseDecay;
              if (window.effectiveAlwaysTrail) {
                  baseDecay = 0.085 * frameScale;
              } else {
                  baseDecay = (this.isDown ? 0.085 : 0.18) * frameScale;
              }
              const maxStep = 0.42;
              for (let i = n - 1; i >= 0; i--) {
                  const t = this.trail[i];
                  const span = Math.max(1, n - 1);
                  const along = n > 1 ? i / span : 1;
                  const towardCursorBias = 1.25 - 0.55 * along;
                  let step = baseDecay * towardCursorBias;
                  if (step > maxStep) step = maxStep;
                  t.life -= step;
                  if (t.life <= 0) this.trail.splice(i, 1);
              }

              const head = this.lastPos;
              const pts =
                  head && this.trail.length > 0
                      ? this.trail.concat([{ x: head.x, y: head.y, life: 1 }])
                      : this.trail.slice();

              if (pts.length < 2) {
                  return;
              }

              const gap = Math.hypot(
                  pts[pts.length - 1].x - pts[pts.length - 2].x,
                  pts[pts.length - 1].y - pts[pts.length - 2].y
              );
              if (gap < 0.75 && this.trail.length === 1) {
                  const fade = Math.max(0, this.trail[0].life);
                  ctx.shadowColor = 'transparent';
                  ctx.beginPath();
                  ctx.arc(pts[0].x, pts[0].y, 2.5 + 2 * fade, 0, Math.PI * 2);
                  ctx.fillStyle = `rgba(${this.rgbAt(0.5)}, ${fade * 0.85})`;
                  ctx.fill();
                  return;
              }

              // 逐段渲染：每段的透明度基于数组索引位置，而非空间位置
              // 防止当鼠标锐角转动时，尾迹变淡后突然出现的问题
              ctx.lineWidth = 5.0;
              ctx.shadowColor = `rgba(${this.color}, 0.6)`;
              ctx.shadowBlur = 3;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;

              const lastIdx = pts.length - 1;
              for (let i = 0; i < lastIdx; i++) {
                  const alphaStart = i / lastIdx;
                  const alphaEnd = (i + 1) / lastIdx;
                  const a0 = pts[i];
                  const a1 = pts[i + 1];

                  const segGrad = ctx.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
                  // 设了颜色二就顺着尾巴渐变（头到尾两个颜色过渡）
                  segGrad.addColorStop(0, `rgba(${this.rgbAt(1 - alphaStart)}, ${alphaStart})`);
                  segGrad.addColorStop(1, `rgba(${this.rgbAt(1 - alphaEnd)}, ${alphaEnd})`);

                  ctx.beginPath();
                  ctx.moveTo(a0.x, a0.y);
                  ctx.lineTo(a1.x, a1.y);
                  ctx.strokeStyle = segGrad;
                  ctx.stroke();
              }

              ctx.shadowColor = 'transparent';
          }

          _strokeRingSegment(wx, wy, radius, a0, a1, lineWidth, strokeStyle) {
              const ctx = this.bufferCtx;
              ctx.beginPath();
              ctx.arc(wx, wy, radius, a0, a1);
              ctx.lineWidth = lineWidth;
              ctx.strokeStyle = strokeStyle;
              ctx.stroke();
          }

          _updateWaves(clickFrameScale) {
              const filled = FILLED_CIRCLE_CFG;
              const rings = RINGS_ANIM_CFG;
              const ctx = this.bufferCtx;

              const updateFilledCircle = (w, waveProg) => {
                  w.life += clickFrameScale;
                  const ease = 1 - Math.pow(1 - waveProg, 3);
                  w.r = filled.rAddRate * this.scale * ease;
                  const alpha = Math.max(0, 1 - waveProg);
                  if (alpha > 0) {
                      ctx.beginPath();
                      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
                      ctx.fillStyle = `rgba(${this.rgbAt(1 - Math.min(1, w.life))},${this.alpha(alpha)})`;
                      // 优化：减少阴影效果
                      ctx.fill();
                  }
              };

              const updateRings = (w, ringProg) => {
                  const getWeightProp = (t) => Math.min(2 - Math.abs(4 * (t - 0.5)), 1);
                  const ringRgbAt = (rProg) => {
                      const t = Math.min(1.2 * rProg, 1);
                      const r = this.ringsStartColor[0] * (1 - t) + this.ringsEndColor[0] * t;
                      const g = this.ringsStartColor[1] * (1 - t) + this.ringsEndColor[1] * t;
                      const b = this.ringsStartColor[2] * (1 - t) + this.ringsEndColor[2] * t;
                      return [Math.round(r), Math.round(g), Math.round(b)];
                  };
                  const getAlpha = (rProg) => Math.min(1.1 - 0.3 * rProg, 1);

                  const r = w.ring;
                  r.ang -= r.rs * clickFrameScale;

                  let start = 0;
                  let end = 0;
                  let len = 0;
                  let seg;

                  for (let i = 0; i < 2; i++) {
                      seg = r.segs[i];
                      const base = r.ang + seg.off;

                      if (ringProg <= rings.lenStopAddPoint) {
                          len = seg.len * (ringProg / rings.lenStopAddPoint);
                          end = base + seg.len;
                          start = end - len;
                      } else if (ringProg > rings.lenStartDimPoint) {
                          len = seg.len * (1 - (ringProg - rings.lenStartDimPoint) / (1 - rings.lenStartDimPoint));
                          start = base;
                          end = start + len;
                      } else {
                          len = seg.len;
                          start = base;
                          end = start + len;
                      }

                      const lineWidthMul = Math.min(-0.8 * (ringProg - 0.8) + 1, 1);
                      const [rr, gg, bb] = ringRgbAt(ringProg);
                      const alphaRing = getAlpha(ringProg);

                      for (let k = 0; k < rings.segNum; k++) {
                          const t0 = k / rings.segNum;
                          const t1 = (k + 1) / rings.segNum;
                          const a0 = start + (end - start) * t0;
                          const a1 = start + (end - start) * t1;

                          if (Math.abs(a1 - a0) < 0.01) continue;

                          const wT = getWeightProp(t0);
                          const lw = (rings.minW * (1 - wT) + rings.maxW * wT) * lineWidthMul;
                          const strokeStyle = `rgba(${rr},${gg},${bb},${alphaRing})`;
                          const radius = w.r + seg.rRoundRate * this.scale;
                          // 光弧
                          this._strokeRingSegment(w.x, w.y, radius, a0, a1, lw, strokeStyle);
                      }
                  }
              };

              for (let i = this.waves.length - 1; i >= 0; i--) {
                  const w = this.waves[i];
                  const waveProg = Math.min(w.life / filled.maxLife, 1);
                  const ringProg = Math.min(w.life / rings.maxLife, 1);

                  updateFilledCircle(w, waveProg);
                  updateRings(w, ringProg);

                  // 回收对象到对象池
                  if (ringProg >= 1 && waveProg >= 1) {
                      this.wavesPool.push(this.waves[i]);
                      this.waves.splice(i, 1);
                  }
              }
          }

          _updateSparks(clickFrameScale, trailFrameScale) {
              const ctx = this.bufferCtx;
              for (let i = this.sparks.length - 1; i >= 0; i--) {
                  const s = this.sparks[i];
                  const fs = s.fromClick ? clickFrameScale : trailFrameScale;
                  s.x += s.vx * fs;
                  s.y += s.vy * fs;
                  s.vx *= Math.pow(s.f, fs);
                  s.vy *= Math.pow(s.f, fs);
                  s.rot += s.rs * fs;
                  s.a -= 0.032 * fs;
                  if (s.a <= 0) {
                      this.sparksPool.push(this.sparks[i]);
                      this.sparks.splice(i, 1);
                      continue;
                  }

                  ctx.save();
                  ctx.translate(s.x, s.y);
                  ctx.rotate(s.rot);
                  ctx.beginPath();
                  ctx.moveTo(0, -s.s);
                  ctx.lineTo(s.s * 0.6, s.s * 0.6);
                  ctx.lineTo(-s.s * 0.6, s.s * 0.6);
                  ctx.fillStyle = `rgba(255,255,255,${this.alpha(s.a)})`;
                  ctx.fill();
                  ctx.restore();
              }
          }

          _canvasRect() {
              return { x: 0, y: 0, w: this.cssWidth, h: this.cssHeight };
          }

          _clipRect(rect) {
              if (!rect) return null;
              const x0 = Math.max(0, Math.floor(rect.x));
              const y0 = Math.max(0, Math.floor(rect.y));
              const x1 = Math.min(this.cssWidth, Math.ceil(rect.x + rect.w));
              const y1 = Math.min(this.cssHeight, Math.ceil(rect.y + rect.h));
              if (x1 <= x0 || y1 <= y0) return null;
              return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          }

          _pointRect(x, y, padding) {
              return {
                  x: x - padding,
                  y: y - padding,
                  w: padding * 2,
                  h: padding * 2,
              };
          }

          _segmentRect(a, b, padding) {
              const x0 = Math.min(a.x, b.x) - padding;
              const y0 = Math.min(a.y, b.y) - padding;
              const x1 = Math.max(a.x, b.x) + padding;
              const y1 = Math.max(a.y, b.y) + padding;
              return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          }

          _intersects(a, b) {
              return (
                  a.x <= b.x + b.w &&
                  a.x + a.w >= b.x &&
                  a.y <= b.y + b.h &&
                  a.y + a.h >= b.y
              );
          }

          _unionRect(a, b) {
              const x0 = Math.min(a.x, b.x);
              const y0 = Math.min(a.y, b.y);
              const x1 = Math.max(a.x + a.w, b.x + b.w);
              const y1 = Math.max(a.y + a.h, b.y + b.h);
              return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          }

          _mergeRects(rects) {
              const merged = [];
              for (const raw of rects) {
                  let rect = this._clipRect(raw);
                  if (!rect) continue;

                  for (let i = 0; i < merged.length; i++) {
                      if (this._intersects(merged[i], rect)) {
                          rect = this._unionRect(merged[i], rect);
                          merged.splice(i, 1);
                          i = -1;
                      }
                  }

                  merged.push(rect);
              }

              return merged;
          }

          _getEffectRects() {
              const rects = [];
              const trailPad = 18 * this.scale + 12;
              const trailPoints =
                  this.lastPos && this.trail.length > 0
                      ? this.trail.concat([{ x: this.lastPos.x, y: this.lastPos.y }])
                      : this.trail;

              if (trailPoints.length === 1) {
                  rects.push(this._pointRect(trailPoints[0].x, trailPoints[0].y, trailPad));
              } else {
                  for (let i = 0; i < trailPoints.length - 1; i++) {
                      rects.push(this._segmentRect(trailPoints[i], trailPoints[i + 1], trailPad));
                  }
              }

              const wavePad = 34 * this.scale + RINGS_ANIM_CFG.maxW + 16;
              for (const wave of this.waves) {
                  const radius = Math.max(wave.r || 0, FILLED_CIRCLE_CFG.rAddRate * this.scale) + wavePad;
                  rects.push(this._pointRect(wave.x, wave.y, radius));
              }

              const maxFrameScale = this.maxDeltaMs / this.baseFrameMs;
              for (const spark of this.sparks) {
                  const speed = Math.hypot(spark.vx || 0, spark.vy || 0);
                  const speedScale = spark.fromClick ? this.clickSpeed : this.trailSpeed;
                  const motionPad = speed * maxFrameScale * speedScale;
                  const sparkPad = Math.max(spark.s || 0, 9 * this.scale) * 2 + motionPad + 12;
                  rects.push(this._pointRect(spark.x, spark.y, sparkPad));
              }

              return this._mergeRects(rects);
          }

          _getRenderRects() {
              if (this.forceFullRedraw) {
                  return [this._canvasRect()];
              }

              return this._mergeRects(this.previousDirtyRects.concat(this._getEffectRects()));
          }

          _clipToRects(ctx, rects) {
              ctx.beginPath();
              for (const rect of rects) {
                  ctx.rect(rect.x, rect.y, rect.w, rect.h);
              }
              ctx.clip();
          }

          _renderToMain(rects) {
              const { mainCtx, mainCanvas, bufferCanvas } = this;
              if (!rects || rects.length === 0) {
                  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
                  mainCtx.drawImage(bufferCanvas, 0, 0);
                  return;
              }

              const dpr = this.dpr || 1;
              for (const rect of rects) {
                  const sx = Math.max(0, Math.floor(rect.x * dpr));
                  const sy = Math.max(0, Math.floor(rect.y * dpr));
                  const sw = Math.min(mainCanvas.width - sx, Math.ceil(rect.w * dpr));
                  const sh = Math.min(mainCanvas.height - sy, Math.ceil(rect.h * dpr));
                  if (sw <= 0 || sh <= 0) {
                      continue;
                  }

                  mainCtx.clearRect(sx, sy, sw, sh);
                  mainCtx.drawImage(bufferCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
              }
          }

          // 执行动画循环
          animationLoops(now) {
              if (this.paused) {
                  // 新增：暂停状态只维持循环，不做任何计算与绘制
                  requestAnimationFrame((nextNow) => this.animationLoops(nextNow));
                  return;
              }
              const hasWork =
                  this.waves.length > 0 ||
                  this.sparks.length > 0 ||
                  this.trail.length > 0;

              // 无粒子时只清主画布，跳过缓冲层绘制与贴图
              if (!hasWork) {
                  // 同步时间基准，避免静止后再出现拖尾/波纹时首帧 delta 被顶到 maxDeltaMs
                  this.lastFrameTime = now;
                  if (this.previousDirtyRects.length > 0) {
                      this._clearBufferRects(this.previousDirtyRects);
                      this._renderToMain(this.previousDirtyRects);
                      this.previousDirtyRects = [];
                  }
                  requestAnimationFrame((nextNow) => this.animationLoops(nextNow));
                  return;
              }

              const deltaMs = Math.min(now - this.lastFrameTime, this.maxDeltaMs);
              this.lastFrameTime = now;
              // 彩虹模式的色相随时间缓慢转圈（约 15 秒一圈），配合 rgbAt 里的"沿轨迹铺开"就是彩虹感
              this.rainbowPhase = (now / 40) % 360;
              const baseScale = deltaMs / this.baseFrameMs;
              const trailFrameScale = baseScale * this.trailSpeed;
              const clickFrameScale = baseScale * this.clickSpeed;

              const bctx = this.bufferCtx;
              const renderRects = this._getRenderRects();
              // 优化：减少全局合成模式的影响范围，仅在缓冲层使用 lighter
              bctx.save();
              this._clipToRects(bctx, renderRects);
              bctx.globalCompositeOperation = "lighter";

              this._clearBufferRects(renderRects);
              this._updateTrail(trailFrameScale);
              this._updateWaves(clickFrameScale);
              this._updateSparks(clickFrameScale, trailFrameScale);

              bctx.globalCompositeOperation = "source-over";
              bctx.restore();

              this._renderToMain(renderRects);
              this.previousDirtyRects = this._getEffectRects();
              this.forceFullRedraw = false;

              requestAnimationFrame((nextNow) => this.animationLoops(nextNow));
          }
      }

      window.spark = new MouseSpark();

      // C# 通信接口

      let lastBoomX = -1, lastBoomY = -1;
      let lastBoomTime = 0;
      let lastMoveX = -1, lastMoveY = -1;

      window.currentInputMode = "mouse";
      window.enableAlwaysTrailEffect = false;
      window.effectiveAlwaysTrail = false;

      window.setInputContext = (mode, alwaysTrailEnabled) => {
          window.currentInputMode = mode === "touch" ? "touch" : "mouse";
          window.enableAlwaysTrailEffect = Boolean(alwaysTrailEnabled);
          window.effectiveAlwaysTrail = window.currentInputMode === "mouse" && window.enableAlwaysTrailEffect;
      };

      window.setInputContext("mouse", false);

      // 接收 C# 传来的物理百分比 (0.0 ~ 1.0)，由前端根据真实的画布宽度自行计算
      window.externalBoom = (percentX, percentY) => {
          const now = Date.now();
          if (percentX === lastBoomX && percentY === lastBoomY && (now - lastBoomTime) < 25) return;
          lastBoomX = percentX;
          lastBoomY = percentY;
          lastBoomTime = now;

          // 百分比乘以 WebView 当前真实的内部宽度
          const cx = percentX * window.innerWidth;
          const cy = percentY * window.innerHeight;
          window.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));
      };

      window.externalMove = (percentX, percentY) => {
          if (percentX === lastMoveX && percentY === lastMoveY) return;
          lastMoveX = percentX;
          lastMoveY = percentY;

          // 方法与上述相同
          const cx = percentX * window.innerWidth;
          const cy = percentY * window.innerHeight;
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
      };

      window.externalUp = () => {
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      };

      window.updateColor = (rgbString, rgbString2, rainbow) => {
          if (window.spark) {
              window.spark.color = rgbString;
              // 颜色二：设了就用它当波纹的收尾色；没设就照旧由颜色一推出来
              window.spark.color2 = rgbString2 || '';
              window.spark.rainbow = !!rainbow;
              window.spark.ringsEndColor = ringsEndColorFromRgb(rgbString2 || rgbString);
          }
      };

      window.updateEffectSettings = (scale, opacity, trailSpeed, clickSpeed) => {
          if (!window.spark) return;
          window.spark.scale = Math.max(0.5, Math.min(3, Number(scale) || 1.5));
          window.spark.opacity = Math.max(0.1, Math.min(1, Number(opacity) || 1.0));
          let t = Number(trailSpeed);
          if (!Number.isFinite(t)) t = 1.0;
          let c = Number(clickSpeed);
          if (!Number.isFinite(c)) c = t;
          window.spark.trailSpeed = Math.max(0.2, Math.min(3, t));
          window.spark.clickSpeed = Math.max(0.2, Math.min(3, c));
      };

      /**
       * 点击特效画在哪儿：默认画在鼠标坐标上；开了自定义指针之后，
       * 画在**箭头尖**底下 —— 用户瞄准的是尖端，圆圈就该落在尖端上。
       *
       * 为什么不能靠改光标热点解决：热点是"指针整体挂在哪"，改它会把箭头也一起挪，
       * 而箭头的位置是用户 2026-09-21 亲手调好的（整体右移 11px，看着舒服）。
       * 所以要动的是特效，不是指针。
       */
      window.setEffectAnchor = (dx, dy) => {
          if (!window.spark) return;
          const nx = Number(dx);
          const ny = Number(dy);
          window.spark.anchorDX = Number.isFinite(nx) ? nx : 0;
          window.spark.anchorDY = Number.isFinite(ny) ? ny : 0;
      };

}

/**
 * 应用特效档位：
 *   off        —— 关闭（画布隐藏 + 暂停绘制）
 *   click      —— 只有点击出波纹（按住拖拽时才有拖尾）
 *   clickTrail —— 点击波纹 + 鼠标移动就拖尾
 */
export function applyMouseEffect(mode: MouseEffect): void {
  if (mode === 'off') {
    if (canvasEl) canvasEl.style.display = 'none'
    if (w.spark) {
      w.spark.paused = true
      w.spark.trail.length = 0
      w.spark.sparks.length = 0
      w.spark.waves.length = 0
    }
    return
  }

  install()

  if (canvasEl) canvasEl.style.display = ''
  if (w.spark) {
    w.spark.paused = false
    // 从关闭切过来时残留的粒子清掉，避免"突然冒出一堆旧波纹"
    w.spark.trail.length = 0
    w.spark.sparks.length = 0
    w.spark.waves.length = 0
  }
  w.setInputContext?.('mouse', mode === 'clickTrail')
}

/** 当前是否已经装上（测试用） */
export const isMouseEffectInstalled = () => installed && !!canvasEl

/** 换颜色：传 "r,g,b" 字符串（例：'255,105,180'）；第二个参数是可选的颜色二（渐变用），
 *  第三个参数打开"彩虹"（颜色随时间/位置流动）。留空 = 单色 */
export function setMouseEffectColor(rgb: string, rgb2 = '', rainbow = false): void {
  if (w.updateColor) w.updateColor(rgb, rgb2, rainbow)
}

/** 读回当前生效的颜色（测试与面板回显用） */
export function readMouseEffectColors(): { color: string; color2: string; rainbow: boolean } | null {
  if (!w.spark) return null
  const s = w.spark as unknown as { color?: string; color2?: string; rainbow?: boolean }
  return { color: s.color ?? '', color2: s.color2 ?? '', rainbow: !!s.rainbow }
}

export interface SparkSettings {
  /** 缩放比例 0.5–3 */
  scale: number
  /** 全局不透明度 0.1–1 */
  opacity: number
  /** 拖尾衰减速度 */
  trailSpeed: number
  /** 点击爆发速度 */
  clickSpeed: number
  /** 拖尾刷新率（Hz，60 = 每帧采样） */
  trailHz: number
}

/** 一次性写入所有视觉参数（缩放 / 不透明度 / 两个速度 / 拖尾刷新率） */
export function applyMouseEffectSettings(s: SparkSettings): void {
  if (w.updateEffectSettings) w.updateEffectSettings(s.scale, s.opacity, s.trailSpeed, s.clickSpeed)
  if (w.spark) w.spark.trailHz = Math.max(1, Math.min(240, s.trailHz))
}

/** 读回当前生效的参数（测试与面板回显用） */
export function readMouseEffectSettings(): SparkSettings | null {
  if (!w.spark) return null
  const s = w.spark as unknown as SparkSettings
  return { scale: s.scale, opacity: s.opacity, trailSpeed: s.trailSpeed, clickSpeed: s.clickSpeed, trailHz: s.trailHz }
}
