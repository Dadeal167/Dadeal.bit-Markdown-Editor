import { Vector2, type AnimationState, type Bone, type Skeleton, type SkeletonData } from '@esotericsoftware/spine-webgl'

export interface LobbyInteractionOptions {
  gaze: boolean
  headPat: boolean
}

export function findLobbyInteraction(data: SkeletonData) {
  const motion = data.animations.find(({ name }) => /^Pat_\d+_M$/i.test(name))
  const action = motion?.name.replace(/_M$/i, '')
  const animation = (name: string) => data.findAnimation(name)?.name ?? null
  const findBone = (name: string) => data.bones.find((bone) => bone.name.toLowerCase() === name.toLowerCase())?.name
  const gazeBone = findBone('Touch_Eye_Key')
  const patPoint = findBone('Touch_Point')
  const eyePoint = findBone('Touch_Eye')
  const gaze = gazeBone && data.transformConstraints.some(({ target, mixX, mixY }) =>
    target.name === gazeBone && (mixX || mixY)) ? gazeBone : null
  const end = action?.replace(/^Pat_/i, 'PatEnd_')
  const pat = motion && action && end && patPoint && eyePoint ? {
    point: patPoint,
    eyes: eyePoint,
    motion: motion.name,
    expression: animation(`${action}_A`),
    endMotion: animation(`${end}_M`),
    endExpression: animation(`${end}_A`),
    duration: motion.duration,
    hairBone: findBone('Touch_Point_Key'),
  } : null
  return { gazeBone: gaze, pat }
}

type Point = { x: number; y: number }

/** 指针坐标从画布映射到骨骼空间，偏移加在每帧的动画姿势上。 */
export function createLobbyInteraction(skeleton: Skeleton, state: AnimationState, options: LobbyInteractionOptions) {
  const rig = findLobbyInteraction(skeleton.data)
  const eye = rig.gazeBone ? skeleton.findBone(rig.gazeBone) : null
  const pat = rig.pat
  const patPoint = pat ? skeleton.findBone(pat.point) : null
  const eyePoint = pat ? skeleton.findBone(pat.eyes) : null
  const hair = pat?.hairBone ? skeleton.findBone(pat.hairBone) : null
  const look = new Vector2()
  const rub = new Vector2()
  const scratch = new Vector2()
  let gazeTarget: Point | null = null
  let patTarget: Point | null = null
  let patHeld = false
  let patTime = 0
  let patActive = false
  const beforePose: { bone: Bone; x: number; y: number }[] = []

  const restore = () => {
    for (const { bone, x, y } of beforePose) {
      bone.x = x
      bone.y = y
    }
    beforePose.length = 0
  }

  const moveBone = (bone: Bone, offset: Vector2) => {
    if (!bone.parent || !bone.active || (!offset.x && !offset.y)) return
    const parent = bone.parent
    scratch.set(bone.x, bone.y)
    parent.localToWorld(scratch)
    scratch.x += offset.x
    scratch.y += offset.y
    parent.worldToLocal(scratch)
    beforePose.push({ bone, x: bone.x, y: bone.y })
    bone.x = scratch.x
    bone.y = scratch.y
  }

  const ease = (offset: Vector2, target: Point | null, origin: Bone | null, radius: number, delta: number) => {
    const x = target && origin ? target.x - origin.worldX : 0
    const y = target && origin ? target.y - origin.worldY : 0
    const strength = radius / Math.max(radius * 4, Math.hypot(x, y))
    const mix = 1 - Math.exp(-delta * 12)
    offset.x += (x * strength - offset.x) * mix
    offset.y += (y * strength - offset.y) * mix
    if (!target && Math.hypot(offset.x, offset.y) < 0.05) offset.set(0, 0)
  }

  const endPat = () => {
    patActive = false
    patTarget = null
    const finish = (track: number, name: string | null) => {
      if (name) {
        state.setAnimation(track, name, false)
        state.addEmptyAnimation(track, 0.16, 0)
      } else if (state.getCurrent(track)) {
        state.setEmptyAnimation(track, 0.16)
      }
    }
    if (pat) {
      finish(1, pat.endMotion)
      finish(2, pat.endExpression)
    }
  }

  return {
    hitsHead(point: Point) {
      if (!options.headPat || !patPoint?.active || !eyePoint?.active) return false
      const distance = Math.hypot(patPoint.worldX - eyePoint.worldX, patPoint.worldY - eyePoint.worldY)
      if (distance < 1) return false
      const x = (point.x - patPoint.worldX) / (distance * 3.6)
      const y = (point.y - patPoint.worldY - distance * 2.25) / (distance * 2.8)
      return x * x + y * y <= 1
    },
    lookAt(point: Point | null) { gazeTarget = point },
    startPat(point: Point) {
      if (!pat) return
      patHeld = true
      patTarget = point
      patTime = 0
      patActive = true
      state.setAnimation(1, pat.motion, false)
      if (pat.expression) state.setAnimation(2, pat.expression, false)
    },
    movePat(point: Point) { if (patHeld) patTarget = point },
    releasePat() { patHeld = false },
    updateOptions(next: LobbyInteractionOptions) {
      options = next
      if (!next.gaze) gazeTarget = null
      if (!next.headPat && patActive) {
        patHeld = false
        endPat()
      }
    },
    beforeAnimation(delta: number) {
      restore()
      if (pat && patActive) {
        patTime += delta
        if (!patHeld && patTime >= Math.max(0.42, pat.duration)) endPat()
      }
    },
    apply(delta: number) {
      const distance = patPoint && eyePoint
        ? Math.hypot(patPoint.worldX - eyePoint.worldX, patPoint.worldY - eyePoint.worldY) : 100
      if (eye) {
        ease(look, options.gaze && !patActive ? gazeTarget : null, eyePoint ?? eye, Math.max(1, distance) * 1.2, delta)
        moveBone(eye, look)
      }
      if (hair) {
        ease(rub, patTarget, patPoint, Math.max(1, distance) * 0.4, delta)
        moveBone(hair, rub)
      }
    },
  }
}
