import { useId } from 'react'

/** The ApiMan mark: an "A" sending a request. Same artwork as build/icon.svg and docs/images/logo.svg. */
export function Logo({ size = 22, title }: { size?: number; title?: string }): React.JSX.Element {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="96 96 832 832" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B3DF5" />
          <stop offset=".55" stopColor="#3B6EF6" />
          <stop offset="1" stopColor="#0FB5D9" />
        </linearGradient>
      </defs>
      <rect x="96" y="96" width="832" height="832" rx="200" fill={`url(#${id})`} />
      <path d="M246 768 L460 256 L674 768" fill="none" stroke="#fff" strokeWidth="92" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M352 600 H778" fill="none" stroke="#fff" strokeWidth="66" strokeLinecap="round" />
      <path d="M716 520 L812 600 L716 680 Z" fill="#fff" stroke="#fff" strokeWidth="30" strokeLinejoin="round" />
    </svg>
  )
}
