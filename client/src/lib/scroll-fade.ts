// Chrome keeps a `scroll-fade` at its last value once its scroller stops overflowing. Shrinking
// content clamps the scroll position, firing one last scroll: restart the fade there.
export function refreshScrollFadesWhenOverflowEnds() {
  document.addEventListener(
    'scroll',
    ({ target }) => {
      if (!(target instanceof HTMLElement) || !target.className.includes('scroll-fade')) return
      if (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth)
        return
      target.style.animationName = 'none'
      void target.offsetWidth
      target.style.animationName = ''
    },
    { capture: true, passive: true }
  )
}
