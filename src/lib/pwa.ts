import { useEffect, useState } from 'react'

/** True when running from the home screen rather than inside a browser. */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Installing, on both kinds of phone.
 *
 * Android fires an event the page can hold on to and replay when the person is ready.
 * iOS fires nothing and never will, so there the only honest option is to say where the
 * button is. Asking on the first visit gets refused, so the prompt waits until somebody
 * has done something worth coming back for.
 */
export function useInstall() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone())

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent) }
    const onInstalled = () => { setInstalled(true); setEvent(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return {
    installed,
    canPrompt: !!event,
    isIos: isIos && !installed,
    install: async () => {
      if (!event) return
      await event.prompt()
      await event.userChoice
      setEvent(null)
    },
  }
}

/** A short tap, where the device offers one. Silent everywhere else. */
export function tap(pattern: number | number[] = 8) {
  navigator.vibrate?.(pattern)
}
