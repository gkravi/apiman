// A small set of 16×16 line icons drawn for ApiMan, so the UI doesn't depend on emoji that render
// differently on every OS. They inherit the text colour.

type IconProps = { size?: number; className?: string }

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const CollectionsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="5.5" width="11" height="8" rx="1.5" />
    <path d="M4.5 3.5h7" />
    <path d="M6 1.75h4" />
  </Svg>
)

export const EnvironmentsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12" />
    <path d="M8 2c1.9 1.8 2.8 3.8 2.8 6S9.9 12.2 8 14C6.1 12.2 5.2 10.2 5.2 8S6.1 3.8 8 2z" />
  </Svg>
)

export const HistoryIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2.3 6.2A6 6 0 1 1 2 8" />
    <path d="M2 3.5v2.9h2.9" />
    <path d="M8 5v3.2l2.2 1.4" />
  </Svg>
)

export const MonitorsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1.5 8.5h2.8l1.7-4 3 7.5 1.8-3.5h3.7" />
  </Svg>
)

export const FolderIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 5a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Svg>
)

export const EyeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)

export const SettingsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Svg>
)

export const CookieIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13.9 8.6A6 6 0 1 1 7.4 2.1a2.2 2.2 0 0 0 2.4 2.6 2.2 2.2 0 0 0 2.7 2.6 2 2 0 0 0 1.4 1.3z" />
    <path d="M5.5 7h.01M8 10.5h.01M5.8 10h.01" strokeWidth={2} />
  </Svg>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)

export const ImportIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 2v8M4.8 7 8 10.2 11.2 7" />
    <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" />
  </Svg>
)

export const LockIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
)

export const UnlockIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
  </Svg>
)
