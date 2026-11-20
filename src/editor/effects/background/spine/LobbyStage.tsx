import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  AnimationState, AnimationStateData, GLTexture, ManagedWebGLRenderingContext,
  Physics, SceneRenderer, Skeleton, Vector2,
} from '@esotericsoftware/spine-webgl'
import type { LobbyScene } from './lobbyAssets'
import { createLobbyInteraction, type LobbyInteractionOptions } from './lobbyInteraction'
import { createLobbyMeteors } from './lobbySceneEffects'
import type { LobbyLayout } from '../lobbySettings'

type CameraLayout = Pick<LobbyLayout, 'zoom' | 'spineX' | 'spineY'>

function renderLobby(
  canvas: HTMLCanvasElement, scene: LobbyScene, builtIn: boolean,
  camera: CameraLayout, options: LobbyInteractionOptions, meteors: boolean,
) {
  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  const gl = context.gl
  let renderer: SceneRenderer | undefined
  let meteorTexture: GLTexture | undefined
  let frame = 0
  let playing = false
  let previous: number | null = null
  let elapsed = 0
  const dispose = () => {
    cancelAnimationFrame(frame)
    scene.atlas.dispose()
    meteorTexture?.dispose()
    renderer?.dispose()
    context.dispose()
  }

  try {
    const view = renderer = new SceneRenderer(canvas, context)
    scene.atlas.pages.forEach((page, index) => page.setTexture(new GLTexture(context, scene.images[index])))
    const skeleton = new Skeleton(scene.data)
    if (scene.meteorImage) meteorTexture = new GLTexture(context, scene.meteorImage)
    const drawMeteors = meteorTexture && createLobbyMeteors(skeleton, view, meteorTexture)
    const stateData = new AnimationStateData(scene.data)
    stateData.defaultMix = 0.12
    const state = new AnimationState(stateData)
    const interaction = createLobbyInteraction(skeleton, state, options)
    state.setAnimation(0, scene.animation, true)
    state.apply(skeleton)
    skeleton.updateWorldTransform(Physics.reset)

    const origin = new Vector2()
    const size = new Vector2()
    skeleton.getBounds(origin, size)
    const bounds = Number.isFinite(size.x + size.y) && size.x > 0 && size.y > 0
      ? { x: origin.x + size.x / 2, y: origin.y + size.y / 2, width: size.x, height: size.y }
      : { x: 0, y: 0, width: 1920, height: 1080 }

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height || gl.isContextLost()) return
      const ratio = Math.min(window.devicePixelRatio, 1.5, 1920 / width, 1440 / height)
      const pixelWidth = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      let { x, y } = bounds
      let scale = Math.max(bounds.width / width, bounds.height / height)
      if (builtIn) {
        // 宽屏上把人物放到默认正文框右侧。
        scale = Math.min(2800 / width, 1940 / height)
        x = width < 1100 ? 60 : width * scale / 2 - 1650
        y = Math.max(1040, 1910 - height * scale / 2)
      }
      const zoomedScale = scale * 100 / camera.zoom
      const viewportWidth = width * zoomedScale
      const viewportHeight = height * zoomedScale
      view.camera.position.set(x - viewportWidth * camera.spineX / 100, y + viewportHeight * camera.spineY / 100, 0)
      view.camera.setViewport(viewportWidth, viewportHeight)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      view.begin()
      if (meteors && drawMeteors) drawMeteors(elapsed, scene.atlas.pages[0].pma)
      else view.drawSkeleton(skeleton, scene.atlas.pages[0].pma)
      view.end()
    }

    const tick = (now: number) => {
      const delta = previous === null ? 0 : Math.min((now - previous) / 1000, 0.1)
      previous = now
      elapsed += delta
      interaction.beforeAnimation(delta)
      skeleton.update(delta)
      state.update(delta)
      state.apply(skeleton)
      skeleton.updateWorldTransform(Physics.none)
      interaction.apply(delta)
      skeleton.updateWorldTransform(Physics.update)
      draw()
      frame = requestAnimationFrame(tick)
    }
    const updatePlayback = () => {
      cancelAnimationFrame(frame)
      previous = null
      if (playing && !document.hidden) frame = requestAnimationFrame(tick)
    }

    let pointer: number | null = null
    const positionOf = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      return {
        x: view.camera.position.x + ((event.clientX - box.left) / box.width - 0.5) * view.camera.viewportWidth,
        y: view.camera.position.y + (0.5 - (event.clientY - box.top) / box.height) * view.camera.viewportHeight,
      }
    }
    const onBackground = (event: PointerEvent) => {
      const target = event.target
      return target instanceof Element && !!target.closest('.editor-shell, .zh-fx__lobby-stage') &&
        !target.closest('.editor-card, button, a, input, textarea, select, [role="dialog"], .zh-outline') &&
        !document.querySelector('.zh-modal-mask')
    }
    const setHover = (value: boolean) => {
      document.documentElement.classList.toggle('zh-fx__lobby-pat-ready', value)
    }
    const release = () => {
      pointer = null
      interaction.releasePat()
      setHover(false)
    }
    const clearPointer = () => {
      release()
      interaction.lookAt(null)
    }
    const onVisibility = () => {
      if (document.hidden) clearPointer()
      updatePlayback()
    }
    const move = (event: PointerEvent) => {
      if (!playing || !event.isPrimary || (!options.gaze && !options.headPat)) return
      const background = onBackground(event)
      const point = positionOf(event)
      const target = event.target
      const writing = target instanceof Element && !!target.closest('.zh-prose, .zh-title') &&
        !target.closest('[role="dialog"]') && !document.querySelector('.zh-modal-mask')
      if (event.pointerType !== 'touch') interaction.lookAt(background || writing ? point : null)
      if (pointer === event.pointerId) {
        if (background && interaction.hitsHead(point)) interaction.movePat(point)
        else release()
      }
      setHover(background && event.pointerType !== 'touch' && interaction.hitsHead(point))
    }
    const down = (event: PointerEvent) => {
      if (!playing || !event.isPrimary || event.button !== 0 || !onBackground(event)) return
      const point = positionOf(event)
      if (!interaction.hitsHead(point)) return
      pointer = event.pointerId
      interaction.startPat(point)
      event.preventDefault()
    }
    const up = (event: PointerEvent) => {
      if (pointer === event.pointerId) release()
    }
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointer()
    }

    draw()
    const resize = new ResizeObserver(draw)
    resize.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextrestored', draw)
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('pointerout', leave)
    window.addEventListener('blur', clearPointer)
    return {
      setCamera(next: CameraLayout) {
        if (next.zoom === camera.zoom && next.spineX === camera.spineX && next.spineY === camera.spineY) return
        camera = next
        draw()
      },
      setMeteors(value: boolean) {
        if (value === meteors) return
        meteors = value
        draw()
      },
      play(value: boolean) {
        if (value === playing) return
        playing = value
        if (!value) clearPointer()
        updatePlayback()
      },
      setInteraction(next: LobbyInteractionOptions) {
        options = next
        interaction.updateOptions(next)
        if (!next.headPat) release()
      },
      dispose() {
        clearPointer()
        resize.disconnect()
        document.removeEventListener('visibilitychange', onVisibility)
        canvas.removeEventListener('webglcontextrestored', draw)
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerdown', down)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        window.removeEventListener('pointerout', leave)
        window.removeEventListener('blur', clearPointer)
        dispose()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}

interface Props {
  scene: LobbyScene
  builtIn: boolean
  playing: boolean
  layout: LobbyLayout
  meteors: boolean
  interaction: LobbyInteractionOptions
  onError(message: string): void
}

export default function LobbyStage({ scene, builtIn, playing, layout, meteors, interaction, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const controller = useRef<ReturnType<typeof renderLobby> | null>(null)
  const settings = useRef({ playing, layout, interaction, meteors })
  settings.current = { playing, layout, interaction, meteors }

  useEffect(() => {
    if (!canvas.current) return
    try {
      const { playing, layout, interaction, meteors } = settings.current
      const lobby = renderLobby(canvas.current, scene, builtIn, layout, interaction, meteors)
      controller.current = lobby
      lobby.play(playing)
      return () => {
        controller.current = null
        lobby.dispose()
      }
    } catch {
      onError('无法启动 Spine 渲染，请检查浏览器是否支持 WebGL。')
    }
  }, [scene, builtIn, onError])

  useEffect(() => controller.current?.play(playing), [playing])
  useEffect(() => controller.current?.setCamera(layout), [layout])
  useEffect(() => controller.current?.setMeteors(meteors), [meteors])
  useEffect(() => controller.current?.setInteraction(interaction), [interaction])

  return createPortal(<canvas ref={canvas} className="zh-fx__lobby-stage" aria-hidden="true" />, document.body)
}
