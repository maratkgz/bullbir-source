import { useState, useEffect } from 'react'
import { breakpointFor, down, up } from '../styles/breakpoints'

export function useMediaQuery(queryStr) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(queryStr).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(queryStr)
    const onChange = (e) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [queryStr])

  return matches
}

/** Current breakpoint name ('xs' … '2xl'), updated on resize. */
export function useBreakpoint() {
  const [name, setName] = useState(() =>
    typeof window !== 'undefined' ? breakpointFor(window.innerWidth) : 'lg',
  )

  useEffect(() => {
    const onResize = () => setName(breakpointFor(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return name
}

/** Phones (xs/sm): bottom navigation, bottom sheets instead of centred dialogs. */
export const useIsMobile = () => useMediaQuery(down('md'))
/** md: icon-only sidebar. */
export const useIsTablet = () => useMediaQuery(`${up('md')} and ${down('lg')}`)
