import {
  ArrowLeft,
  ArrowRight,
  Atom,
  Award,
  ShieldCheck,
  BookOpen,
  BookMarked,
  Bookmark,
  BookmarkMinus,
  BrainCircuit,
  CalendarDays,
  Calculator,
  CheckCheck,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock,
  Cloud,
  CloudOff,
  Compass,
  Contrast,
  Crosshair,
  Dna,
  Flame,
  FlaskConical,
  GraduationCap,
  Hand,
  Hourglass,
  House,
  Languages,
  Library,
  Lightbulb,
  LogOut,
  MapPinOff,
  MessageCircle,
  Mic,
  MicOff,
  Notebook,
  PartyPopper,
  Pause,
  Pencil,
  Phone,
  Play,
  PlayCircle,
  Rocket,
  RotateCcw,
  Search,
  SearchX,
  Send,
  Settings as SettingsIcon,
  SkipForward,
  Sparkles,
  SquareCheckBig,
  Trash2,
  TrendingUp,
  Trophy,
  User,
  Volume2,
  Waves,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * ONE ICON COMPONENT, DRAWN BY LUCIDE.
 *
 * It used to render Material Symbols — Google's default set, which is the
 * fastest way for an app to look like every other app built from a template,
 * and which arrived as a webfont over the network.
 *
 * Lucide is drawn as SVG, so each icon is tree-shaken into the bundle, needs
 * no font request, and inherits `currentColor` and the surrounding font-size
 * the way the Material span did. Nothing that uses this component changed:
 * the NAMES stay exactly as they were, because forty-one call sites and a
 * dozen data tables spell them the Material way and renaming them would be a
 * migration with no reader-visible benefit.
 *
 * A name with no entry falls back to a dot rather than throwing — a missing
 * icon should never take a screen down, and a visible dot is how it gets
 * noticed and fixed.
 */

/** Material Symbols name -> the Lucide glyph that means the same thing. */
const GLYPHS: Record<string, LucideIcon> = {
  arrow_back: ArrowLeft,
  arrow_forward: ArrowRight,
  auto_awesome: Sparkles,
  back_hand: Hand,
  book: BookOpen,
  bookmark: Bookmark,
  bookmark_remove: BookmarkMinus,
  calculate: Calculator,
  calendar_month: CalendarDays,
  done_all: CheckCheck,
  library_books: Library,
  cancel: X,
  celebration: PartyPopper,
  check: Check,
  check_circle: CheckCircle2,
  chevron_right: ChevronRight,
  close: X,
  closed_caption: Captions,
  cloud_done: Cloud,
  cloud_off: CloudOff,
  contrast: Contrast,
  delete: Trash2,
  delete_forever: Trash2,
  edit: Pencil,
  edit_note: Notebook,
  error: CircleAlert,
  expand_less: ChevronDown,
  expand_more: ChevronDown,
  experiment: FlaskConical,
  explore: Compass,
  explore_off: MapPinOff,
  forum: MessageCircle,
  front_hand: Hand,
  genetics: Dna,
  graphic_eq: Waves,
  help: CircleHelp,
  home: House,
  hourglass_top: Hourglass,
  insights: TrendingUp,
  lightbulb: Lightbulb,
  local_fire_department: Flame,
  logout: LogOut,
  menu_book: BookMarked,
  mic: Mic,
  mic_off: MicOff,
  motion_photos_off: Pause,
  my_location: Crosshair,
  pause: Pause,
  person: User,
  play_arrow: Play,
  play_circle: PlayCircle,
  psychology: BrainCircuit,
  public: Compass,
  quiz: SquareCheckBig,
  record_voice_over: Volume2,
  replay: RotateCcw,
  restart_alt: RotateCcw,
  rocket_launch: Rocket,
  schedule: Clock,
  school: GraduationCap,
  science: Atom,
  search: Search,
  search_off: SearchX,
  send: Send,
  settings: SettingsIcon,
  skip_next: SkipForward,
  translate: Languages,
  trending_up: TrendingUp,
  trophy: Trophy,
  verified: ShieldCheck,
  wifi_off: WifiOff,
  workspace_premium: Award,
  call_end: Phone,
  keyboard: Notebook,
};

export function Icon({
  name,
  filled = false,
  className = '',
}: {
  /** The name as the call sites already spell it, e.g. "play_arrow". */
  name: string;
  /**
   * Material had two cuts of every glyph. Lucide has one, so this thickens
   * the stroke instead — the same signal (this one is active) in the
   * vocabulary the new set actually has.
   */
  filled?: boolean;
  className?: string;
}) {
  const Glyph = GLYPHS[name];
  if (!Glyph) {
    // Loud enough to be spotted in review, quiet enough not to break a screen.
    return (
      <span aria-hidden data-icon={name} className={`inline-block ${className}`}>
        •
      </span>
    );
  }
  return (
    <Glyph
      aria-hidden
      /**
       * The name the APP uses, kept in the DOM.
       *
       * Not decoration: it is what lets a screen test say "there is a
       * raised-hand icon per row" without knowing which icon library drew it.
       * The Material set left its name as the span text and tests counted
       * that; swapping to Lucide silently emptied those counts. This is the
       * same signal, owned by us rather than borrowed from a vendor.
       */
      data-icon={name}
      className={className}
      // Sized from the surrounding text, exactly as the Material span was, so
      // every existing `text-[22px]` keeps meaning what it meant.
      size="1em"
      strokeWidth={filled ? 2.6 : 2}
    />
  );
}
