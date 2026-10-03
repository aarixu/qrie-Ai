import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
/** Below Tailwind's sm breakpoint (40rem): a phone held upright. */
const NARROW_QUERY = 'not all and (min-width: 40rem)'

function useMediaQuery(query: string) {
  return React.useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY)
}

/**
 * True below sm, where the marking screens show a card per student instead
 * of a table. One layout is rendered at a time, so a mark box is never kept
 * twice with two different values.
 */
export function useIsNarrow() {
  return useMediaQuery(NARROW_QUERY)
}
