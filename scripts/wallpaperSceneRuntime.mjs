import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { resolve } from 'node:path'

// WebWallGL 3.0.2 只在绘制图层本身时上传视频帧。效果引用的视频纹理
// 因此一直保留初始透明帧。提取原上传流程并在效果采样前复用，仍保留
// 引擎的尺寸限制、上传去重与失败回退；不改动 node_modules 或用户素材。
export function buildWallpaperSceneRuntime(root) {
  let source = readFileSync(resolve(root, 'webwallgl.mjs'), 'utf8').replace(/\r\n/g, '\n')
  const renderStart = '  async function renderLayer(layer, textures2, cam, viewProj, width, height, time) {'
  const videoStart = '    if (texObj && texObj.video) {'
  const videoEnd = '    if (texObj && texObj.animatedImage) {'
  const start = source.indexOf(videoStart, source.indexOf(renderStart))
  const end = source.indexOf(videoEnd, start)
  const binding = `        const t = entry.fbo ? entry : { tex: entry.glTex || whiteTex, width: entry.width || 1, height: entry.height || 1 };
        gl.activeTexture(gl.TEXTURE0 + ti);`
  const videoEntry = '            lastUploaded: -1,\n            videoCtl\n'
  const videoMetadata = '          pair.active.addEventListener("loadedmetadata", () => {'
  const texturePlayer = '          const pair = createLoopingVideo(url, {\n            muted: true,'
  const textureSwap = '          pair.onSwap = (el) => {\n            entry2.lastUploaded = -1;'
  const mountOptions = '    autoQuality: o.autoQuality,\n    scripts:'
  const loopStart = source.indexOf('function createLoopingVideo(src, opts) {')
  const loopEnd = source.indexOf('function isWebKitGtk()', loopStart)
  if (start < 0 || end < 0 || loopStart < 0 || loopEnd < 0 ||
      [binding, videoEntry, videoMetadata, texturePlayer, textureSwap, mountOptions].some((anchor) => !source.includes(anchor))) {
    throw new Error('WebWallGL 视频纹理兼容补丁与当前依赖版本不匹配，请重新核对渲染流程。')
  }
  // 分时播放由双视频播放器准备并交换解码器。上传只接受当前区间内的帧。
  const videoUpload = source.slice(start, end).replace('      const v = texObj.video;', `      const v = texObj.video;
      if (texObj.allowsFrame && !texObj.allowsFrame(v)) return;
      const loopBlend = texObj.loopBlend?.();
      const fade = texObj.periodFade;
      const phaseMix = fade ? Math.min(1, (performance.now() - fade.started) / 320) : 1;
      if (phaseMix === 1) texObj.periodFade = undefined;
      const mix = loopBlend?.mix ?? phaseMix;
      const baseFrame = loopBlend ? v : phaseMix < 1 ? fade.frame : null;
      const overlay = loopBlend?.video ?? v;`)
    .replace('v.currentTime !== texObj.lastUploaded', '(v.currentTime !== texObj.lastUploaded || fade || loopBlend)')
    .replace('videoDirectFailed && videoCanvas &&', '(videoDirectFailed || baseFrame) && videoCanvas &&')
    .replace('              vctx.drawImage(v, 0, 0, uw, uh);', `              if (baseFrame && mix < 1) vctx.drawImage(baseFrame, 0, 0, uw, uh);
              vctx.globalAlpha = mix;
              try { vctx.drawImage(overlay, 0, 0, uw, uh); }
              finally { vctx.globalAlpha = 1; }`)
  source = source.slice(0, start) + '    uploadVideoTexture(texObj, layer, width, height);\n' + source.slice(end)
  source = source.replace(renderStart, `  function uploadVideoTexture(texObj, layer, width, height) {
${videoUpload}  }
${renderStart}`)
  source = source.replace(binding, `        gl.activeTexture(gl.TEXTURE0 + ti);
        uploadVideoTexture(entry, layer, width, height);
        const t = entry.fbo ? entry : { tex: entry.glTex || whiteTex, width: entry.width || 1, height: entry.height || 1 };`)
  source = source.replace(mountOptions, `    autoQuality: o.autoQuality,
    videoLoopPlan: o.videoLoopPlan,
    createVideoClip: o.createVideoClip,
    onVideoTexture: o.onVideoTexture,
    scripts:`)
  source = source.replace(videoMetadata, `${videoMetadata}
            cfg.onVideoTexture?.(name, pair.active.duration);`)
  source = source.replace(videoEntry, `            lastUploaded: -1,
            allowsFrame: (video) => pair.allowsFrame(video),
            loopBlend: () => pair.loopBlend(),
            videoCtl
`)
  source = source.replace(texturePlayer, `${texturePlayer}
            clipPlan: cfg.videoLoopPlan && ((duration) => cfg.videoLoopPlan(name, duration)),
            createClip: cfg.createVideoClip,`)
  source = source.replace(textureSwap, `          pair.onSwap = (el, previousPeriod) => {
            entry2.lastUploaded = -1;
            entry2.periodFade = undefined;
            if (previousPeriod?.readyState >= 2 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
              // 跨时段时缓存上一帧。同一时段的循环会合成仍在播放的片尾和片头。
              try {
                const frame = document.createElement("canvas");
                const scale = Math.min(1, 1920 / Math.max(previousPeriod.videoWidth, previousPeriod.videoHeight));
                frame.width = Math.max(1, Math.round(previousPeriod.videoWidth * scale));
                frame.height = Math.max(1, Math.round(previousPeriod.videoHeight * scale));
                const context = frame.getContext("2d");
                if (context) {
                  context.drawImage(previousPeriod, 0, 0, frame.width, frame.height);
                  entry2.periodFade = { frame, started: performance.now() };
                }
              } catch {}
            }`)
  // 保留原生循环；启用分时规则时复用同一对媒体元素和现有的纹理换帧回调。
  let loop = source.slice(loopStart, loopEnd)
  const replaceLoop = (before, after) => {
    if (!loop.includes(before)) throw new Error('WebWallGL 分时播放补丁与当前播放器版本不匹配。')
    loop = loop.replace(before, after)
  }
  replaceLoop('if (destroyed || el !== active) return;', 'if (destroyed || el !== active || opts.clipPlan?.(el.duration)) return;')
  replaceLoop('const doSwap = () => {', 'const doSwap = (keepPosition = false, periodChanged = false) => {')
  replaceLoop('prev.currentTime = 0;', 'if (!keepPosition) prev.currentTime = 0;')
  replaceLoop('pair.onSwap?.(active);', 'pair.onSwap?.(active, periodChanged ? prev : undefined);')
  replaceLoop('    onSwap: void 0,', `    allowsFrame: (video) => clip?.allowsFrame(video) ?? true,
    loopBlend: () => clip?.loopBlend(),
    onSwap: void 0,`)
  replaceLoop('  const tick = () => {', `  const clip = opts.createClip?.({
    active: () => active,
    standby: () => {
      standby.preload = "auto";
      ensureStandbySrc();
      return standby;
    },
    swap: (periodChanged) => doSwap(true, periodChanged),
    plan: (duration) => opts.clipPlan?.(duration)
  });
  const tick = () => {`)
  replaceLoop('    if (!isFinite(d) || d <= 0) return;', `    if (!isFinite(d) || d <= 0) return;
    if (clip?.tick()) {
      if (crawling || fading) disarm();
      return;
    }`)
  replaceLoop('      wantPlay = false;\n      disarm();', '      wantPlay = false;\n      clip?.reset();\n      disarm();')
  replaceLoop('      disarm();\n      const el = active;', '      clip?.reset();\n      disarm();\n      const el = active;')
  replaceLoop('      } else {\n        disarm();\n        active.pause();', '      } else {\n        clip?.reset();\n        disarm();\n        active.pause();')
  replaceLoop('      if (rate === 0) return;', '      if (rate === 0 || clip?.holding) return;')
  source = source.slice(0, loopStart) + loop + source.slice(loopEnd)
  return buildSync({
    stdin: { contents: source, resolveDir: root, sourcefile: 'webwallgl.mjs', loader: 'js' },
    bundle: true, write: false, format: 'iife', globalName: 'WebWallGL',
    platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline',
  }).outputFiles[0].text
}
