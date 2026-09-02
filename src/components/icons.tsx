/**
 * Icon set. Drawn on a 16px grid so strokes land on whole pixels, and everything uses
 * currentColor so an icon inherits whatever it sits inside.
 *
 * Filled shapes for transport, because at 12px a stroked triangle turns to mush.
 * Stroked shapes at 1.5 for everything else.
 */

type P = { size?: number; className?: string }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Svg({ size = 16, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className}
      aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

/* Optically centered: a triangle looks off-center when it is mathematically centered. */
export const Play = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <path d="M5.4 3.3 12.1 7.6a.5.5 0 0 1 0 .84L5.4 12.7a.5.5 0 0 1-.77-.42V3.72a.5.5 0 0 1 .77-.42Z"
      fill="currentColor" />
  </Svg>
)

export const Pause = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <rect x="4.6" y="3.5" width="2.4" height="9" rx="1" fill="currentColor" />
    <rect x="9" y="3.5" width="2.4" height="9" rx="1" fill="currentColor" />
  </Svg>
)

export const SkipBack = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <rect x="3.4" y="4" width="1.6" height="8" rx=".8" fill="currentColor" />
    <path d="M12.1 4.3v7.4a.5.5 0 0 1-.78.42L6.3 8.42a.5.5 0 0 1 0-.84l5.02-3.7a.5.5 0 0 1 .78.42Z"
      fill="currentColor" />
  </Svg>
)

export const SkipForward = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <path d="M3.9 4.3v7.4a.5.5 0 0 0 .78.42L9.7 8.42a.5.5 0 0 0 0-.84L4.68 3.88a.5.5 0 0 0-.78.42Z"
      fill="currentColor" />
    <rect x="11" y="4" width="1.6" height="8" rx=".8" fill="currentColor" />
  </Svg>
)

export const Check = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}><path d="m3.5 8.4 3 3 6-6.8" {...stroke} /></Svg>
)

export const ChevronDown = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}><path d="m4 6.5 4 4 4-4" {...stroke} /></Svg>
)

export const ChevronUp = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}><path d="m4 9.5 4-4 4 4" {...stroke} /></Svg>
)

export const Close = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}><path d="m4.5 4.5 7 7m0-7-7 7" {...stroke} /></Svg>
)

export const Upload = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <path d="M8 10.5V3m0 0L5.2 5.8M8 3l2.8 2.8M3 10.5v1.6A1.4 1.4 0 0 0 4.4 13.5h7.2a1.4 1.4 0 0 0 1.4-1.4v-1.6"
      {...stroke} />
  </Svg>
)

export const Plus = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}><path d="M8 3.5v9M3.5 8h9" {...stroke} /></Svg>
)

export const Spinner = ({ size = 16, ...p }: P) => (
  <Svg size={size} {...p}>
    <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
    <path d="M8 2.8a5.2 5.2 0 0 1 5.2 5.2" {...stroke}>
      <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8"
        dur="0.8s" repeatCount="indefinite" />
    </path>
  </Svg>
)
