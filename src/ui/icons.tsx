// SF Symbols used by the Swift app → nearest Lucide icons (V-06, plan.md → «Іконки»).
import {
  ALargeSmall, ArrowRight, AudioLines, Bookmark, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleArrowRight, CircleCheck, CircleHelp, CircleX, Copy, Ellipsis, ExternalLink, GraduationCap, GripVertical,
  Headphones, Keyboard, Languages, Library, LibraryBig, List, Mic, Minus, Pause, Play, Plus, RotateCcw, RotateCw, Search, Settings, Share,
  SkipForward, Sparkles, Square, TriangleAlert, Trash2, Type, Volume2, X, type LucideIcon,
} from 'lucide-preact'

const icons = {
  'books.vertical': LibraryBig,
  library: Library,
  plus: Plus,
  minus: Minus,
  gearshape: Settings,
  bookmark: Bookmark,
  'list.bullet': List,
  'character.bubble': Languages,
  textformat: Type,
  'textformat.size': ALargeSmall,
  xmark: X,
  'play.fill': Play,
  'pause.fill': Pause,
  'stop.fill': Square,
  'chevron.left': ChevronLeft,
  'chevron.right': ChevronRight,
  'chevron.up': ChevronUp,
  'chevron.down': ChevronDown,
  'exclamationmark.triangle.fill': TriangleAlert,
  'speaker.wave.2': Volume2,
  'speaker.wave.3.fill': Volume2,
  checkmark: Check,
  'checkmark.circle.fill': CircleCheck,
  'xmark.circle.fill': CircleX,
  trash: Trash2,
  'square.and.arrow.up': Share,
  'arrow.right.circle': CircleArrowRight,
  'arrow.right': ArrowRight,
  mic: Mic,
  magnifyingglass: Search,
  book: BookOpen,
  'doc.on.doc': Copy,
  'arrow.counterclockwise': RotateCcw,
  'line.3.horizontal': GripVertical,
  keyboard: Keyboard,
  sparkles: Sparkles,
  ellipsis: Ellipsis,
  safari: ExternalLink,
  'graduationcap': GraduationCap,
  'waveform': AudioLines,
  forward: SkipForward,
  questionmark: CircleHelp,
  headphones: Headphones,
  'gobackward.15': RotateCcw,
  'goforward.15': RotateCw,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof icons

export interface IconProps {
  name: IconName
  size?: number
  /** Solid variant (SF *.fill): fills the shape with the current color. */
  filled?: boolean
  strokeWidth?: number
  class?: string
  label?: string
}

export function Icon({ name, size = 20, filled = false, strokeWidth = 2, class: className, label }: IconProps) {
  const Component = icons[name]
  const solid = filled || name.endsWith('.fill')
  return (
    <Component
      size={size}
      strokeWidth={strokeWidth}
      fill={solid && name !== 'exclamationmark.triangle.fill' ? 'currentColor' : 'none'}
      class={['icon', className].filter(Boolean).join(' ')}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
