import { useInstall, tap } from '../lib/pwa'
import { Play, Plus, Check, Close } from './icons'
import { useState } from 'react'

export type Tab = 'episodes' | 'vault' | 'cast' | 'team'

/**
 * The bottom bar.
 *
 * A sidebar is a desktop idea: it assumes a pointer and a wide screen. On a phone the
 * navigation belongs at the bottom, within reach of a thumb, and it should stay put while
 * everything above it changes. Four destinations is the most that stays legible; a fifth
 * would push this into a menu, and a menu is where navigation goes to be ignored.
 */
export default function MobileTabs({
  tab, onTab, counts,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  counts: { waiting: number; emptyVault: number; voiceless: number }
}) {
  const items: { key: Tab; label: string; badge?: number; icon: JSX.Element }[] = [
    { key: 'episodes', label: 'Episodes', badge: counts.waiting, icon: <Play size={17} /> },
    { key: 'vault', label: 'Vault', badge: counts.emptyVault, icon: <Plus size={17} /> },
    { key: 'cast', label: 'Cast', badge: counts.voiceless, icon: <Check size={17} /> },
    { key: 'team', label: 'Team', icon: <Close size={17} /> },
  ]

  return (
    <nav className="tabs" aria-label="Sections">
      {items.map(item => (
        <button
          key={item.key}
          aria-current={tab === item.key}
          onClick={() => { tap(); onTab(item.key) }}
        >
          <span className="tab-icon">
            {item.icon}
            {!!item.badge && item.badge > 0 && <span className="tab-badge">{item.badge}</span>}
          </span>
          <span className="tab-label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

/**
 * The invitation to install, once something is worth coming back to.
 *
 * Asking on arrival gets refused, so this waits for a reason to exist. Android can be
 * asked properly; iOS cannot be asked at all, so there the only honest thing is to say
 * where the button is and get out of the way.
 */
export function InstallPrompt({ ready }: { ready: boolean }) {
  const { installed, canPrompt, isIos, install } = useInstall()
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('estudio.installDismissed') === '1',
  )

  if (installed || dismissed || !ready || (!canPrompt && !isIos)) return null

  function hide() {
    setDismissed(true)
    localStorage.setItem('estudio.installDismissed', '1')
  }

  return (
    <div className="install">
      <div className="install-main">
        <strong>Put Estudio on your home screen</strong>
        <span>
          {isIos
            ? 'Share, then Add to Home Screen. It opens on its own, without the browser around it.'
            : 'It opens instantly, keeps working without signal, and shows on the lock screen while an episode plays.'}
        </span>
      </div>
      {canPrompt && (
        <button className="phone-btn is-primary" onClick={() => { tap(); install() }}>
          Install
        </button>
      )}
      <button className="icon-btn" aria-label="Not now" onClick={hide}>
        <Close size={14} />
      </button>
    </div>
  )
}
