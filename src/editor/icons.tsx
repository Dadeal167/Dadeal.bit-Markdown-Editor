import type { SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconUndo = () => (
  <svg {...base}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12" />
  </svg>
)

export const IconRedo = () => (
  <svg {...base}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12" />
  </svg>
)

export const IconClearFormat = () => (
  <svg {...base}>
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontSize="13"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="inherit"
    >
      A
    </text>
    <path d="M5.5 19.5 18.5 5.5" strokeWidth="1.9" />
  </svg>
)

export const IconUL = () => (
  <svg {...base}>
    <circle cx="6" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="6" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    <path d="M10 6.5h9M10 12h9M10 17.5h9" />
  </svg>
)

export const IconOL = () => (
  <svg {...base}>
    <path d="M10 6.5h9M10 12h9M10 17.5h9" />
    <text x="5.2" y="9.2" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">
      1
    </text>
    <text x="5.2" y="14.7" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">
      2
    </text>
    <text x="5.2" y="20.2" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">
      3
    </text>
  </svg>
)

export const IconQuote = () => (
  <svg {...base}>
    <path d="M10 8.5c-2.6 0-4.2 1.5-4.2 4.1 0 2.2 1.3 3.6 2.8 3.6 1.3 0 2.2-.9 2.2-2 0-1.1-.7-1.9-1.7-1.9.9-.5 1.8-.8 3.2-.8" />
    <path d="M20 8.5c-2.6 0-4.2 1.5-4.2 4.1 0 2.2 1.3 3.6 2.8 3.6 1.3 0 2.2-.9 2.2-2 0-1.1-.7-1.9-1.7-1.9.9-.5 1.8-.8 3.2-.8" />
  </svg>
)

export const IconHr = () => (
  <svg {...base}>
    <path d="M4 12h16" />
    <path d="M4 6.5h16" opacity="0.35" />
    <path d="M4 17.5h16" opacity="0.35" />
  </svg>
)

export const IconCode = () => (
  <svg {...base}>
    <path d="m8.5 8.5-4 3.5 4 3.5" />
    <path d="m15.5 8.5 4 3.5-4 3.5" />
    <path d="M13.5 5.5 10.5 18.5" />
  </svg>
)

export const IconImage = () => (
  <svg {...base}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m5.5 17 4.5-4.5 3 3 2.5-2.5 3 4" />
  </svg>
)

export const IconLink = () => (
  <svg {...base}>
    <path d="M10 14.2a4.4 4.4 0 0 0 6.4.2l2.7-2.7a4.4 4.4 0 0 0-6.2-6.2l-1.2 1.2" />
    <path d="M14 9.8a4.4 4.4 0 0 0-6.4-.2l-2.7 2.7a4.4 4.4 0 0 0 6.2 6.2l1.2-1.2" />
  </svg>
)

export const IconFormula = () => (
  <svg {...base}>
    <text
      x="12"
      y="16.5"
      textAnchor="middle"
      fontSize="14"
      fill="currentColor"
      stroke="none"
      fontFamily="Georgia, serif"
    >
      ∑
    </text>
    <path d="M17 5.5h-4v13h4" opacity="0.5" />
  </svg>
)

export const IconTable = () => (
  <svg {...base}>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M4 10h16M4 15h16M10 5v14M15.5 5v14" />
  </svg>
)

export const IconMore = () => (
  <svg {...base}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
)

export const IconInfo = () => (
  <svg {...base} width={15} height={15}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)

export const IconOpen = () => (
  <svg {...base}>
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z" />
    <path d="M3.5 11h17" opacity="0.5" />
  </svg>
)

export const IconSave = () => (
  <svg {...base}>
    <path d="M5 4h9.5L19 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 4v5h6" />
    <path d="M8 20v-5h8v5" />
  </svg>
)

export const IconExport = () => (
  <svg {...base}>
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
)

/** 存为 PDF：一张纸 + 向下的箭头 */
export const IconPdf = () => (
  <svg {...base}>
    <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M13 3v5h5" />
    <path d="M12 12v4" />
    <path d="m10 14 2 2 2-2" />
  </svg>
)

export const IconVideo = () => (
  <svg {...base}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M10.5 9.8l4.2 2.2-4.2 2.2z" />
  </svg>
)

export const IconOutline = () => (
  <svg {...base}>
    <path d="M4 6h9M7 12h9M10 18h9" />
    <circle cx="3" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconToc = () => (
  <svg {...base}>
    <path d="M4 6h16M4 12h16M4 18h16" opacity="0.4" />
    <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconFootnote = () => (
  <svg {...base}>
    <path d="M4 5h16" />
    <path d="M12 5v11" />
    <path d="M8.5 20h7" />
    <path d="M7 16.5 12 20l5-3.5" opacity="0.6" />
  </svg>
)

/** 主题：左半实心、右半空心的圆（浅深色的意思） */
export const IconTheme = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" stroke="none" />
  </svg>
)

/** 特效：一颗四角星 + 一点小星 */
export const IconSpark = () => (
  <svg {...base}>
    <path d="M11 4.5l1.7 4.3 4.3 1.7-4.3 1.7L11 16.5l-1.7-4.3L5 10.5l4.3-1.7z" />
    <path d="M17.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" opacity="0.65" />
  </svg>
)

export const IconSearch = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
)
