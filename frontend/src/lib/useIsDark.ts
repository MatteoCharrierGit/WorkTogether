import { useEffect, useState } from 'react'

// Osserva la classe `.dark` sull'elemento <html> (gestita da ThemeProvider)
// così i componenti possono reagire al cambio tema chiaro/scuro.
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}
