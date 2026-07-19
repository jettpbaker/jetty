import type { RefObject } from 'react'

import { useEffect, useRef } from 'react'

import type { GlowConfigPatch } from './config'

import { GlowEngine } from './engine'

export type GlowHandle = {
  /** fire the submit pulse */
  burst: () => void
  /** update any knobs at runtime */
  set: (patch: GlowConfigPatch) => void
}

/**
 * Mounts a GlowEngine behind `targetRef`, rendering into `containerRef`.
 *
 * The container must be `position: relative; isolation: isolate` (the canvas
 * is absolute inset-0 z--1 inside it, so it paints behind the container's
 * static children but above the page background). The target element's
 * border-radius is read as the glow's shape radius.
 */
export function useGlow(
  targetRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  config?: GlowConfigPatch
): GlowHandle {
  const engineRef = useRef<GlowEngine | null>(null)
  const handleRef = useRef<GlowHandle>({
    burst: () => engineRef.current?.burst(),
    set: (patch) => engineRef.current?.set(patch),
  })
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    const target = targetRef.current
    const container = containerRef.current
    if (!target || !container) return
    const engine = new GlowEngine(configRef.current ?? {})
    engineRef.current = engine
    engine.attach(target, container)
    return () => {
      engineRef.current = null
      engine.destroy()
    }
  }, [targetRef, containerRef])

  return handleRef.current
}
