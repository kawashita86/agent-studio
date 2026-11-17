import { useCallback, useEffect, useState } from 'react'
import { readLastSeen, writeLastSeen } from './newSince'

export interface LastSeen {
  /** The "New since" divider of the events log; `null` on a first visit or once cleared. */
  marker: number | null
  /**
   * When the user last saw the Overview, as read at the start of this visit. Not touched by
   * `clearMarker`, so the "Since you were away" digest keeps its window for the whole visit.
   */
  visitFrom: number | null
  clearMarker: () => void
}

/**
 * The time the user last saw the Overview. Written when the view goes away or the
 * document is hidden, re-read when the document is shown again.
 * Owned by `OverviewView` so the digest and the events log share one marker.
 */
export function useLastSeen(): LastSeen {
  const [visitFrom, setVisitFrom] = useState<number | null>(readLastSeen)
  const [marker, setMarker] = useState<number | null>(() => visitFrom)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        writeLastSeen(Date.now())
      } else {
        const seen = readLastSeen()
        setVisitFrom(seen)
        setMarker(seen)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      writeLastSeen(Date.now())
    }
  }, [])
  const clearMarker = useCallback(() => setMarker(null), [])
  return { marker, visitFrom, clearMarker }
}
