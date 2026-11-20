import { useLayoutEffect, type RefObject } from 'react'

export function useAnchoredMenu(open: boolean, anchor: RefObject<HTMLElement | null>,
  menu: RefObject<HTMLElement | null>, direction: 'down' | 'up' = 'down') {
  useLayoutEffect(() => {
    const panel = menu.current
    if (__BUILD_MODE__ !== 'effect' || !open || !panel || !anchor.current) return
    const padding = 8
    const trigger = anchor.current
    const position = () => {
      const button = trigger.getBoundingClientRect()
      panel.style.position = 'fixed'
      panel.style.maxWidth = `${Math.max(1, document.documentElement.clientWidth - padding * 2)}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      const gap = 6
      const spaceAbove = button.top - padding - gap
      const spaceBelow = innerHeight - button.bottom - padding - gap
      const preferred = direction === 'up' ? spaceAbove : spaceBelow
      const alternate = direction === 'up' ? spaceBelow : spaceAbove
      const flip = alternate > preferred && preferred < panel.scrollHeight + 2
      const above = flip ? direction === 'down' : direction === 'up'
      const availableHeight = above ? spaceAbove : spaceBelow
      const height = Math.max(1, Math.min(innerHeight - padding * 2, Math.max(160, availableHeight)))
      panel.style.maxHeight = `min(var(--zh-popup-height-limit, 100dvh), ${height}px)`
      const left = direction === 'up' ? button.right - panel.offsetWidth : button.left
      const top = above ? button.top - panel.offsetHeight - gap : button.bottom + gap
      panel.style.left = `${Math.max(padding, Math.min(left, document.documentElement.clientWidth - panel.offsetWidth - padding))}px`
      panel.style.top = `${Math.max(padding, Math.min(top, innerHeight - panel.offsetHeight - padding))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    observer.observe(trigger)
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) position()
    }
    window.addEventListener('resize', position)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, anchor, menu, direction])
}
