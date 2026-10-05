import type { ComponentType } from 'react'

import * as shapes from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'

export type IconProps = Omit<
  HugeiconsIconProps,
  'icon' | 'strokeWidth' | 'absoluteStrokeWidth' | 'viewBox'
> & { filled?: boolean }
export type Icon = ComponentType<IconProps>

// The inset viewBox draws the 24-unit shape 1.125× its slot; index.css keeps the line 1.333px.
function hugeIcon(shape: IconSvgElement): Icon {
  return function HugeIcon({ filled = false, ...props }: IconProps) {
    return (
      <HugeiconsIcon
        size={16}
        aria-hidden='true'
        {...props}
        icon={shape}
        viewBox='1.333333 1.333333 21.333333 21.333333'
        data-icon-pack='huge'
        data-filled={filled || undefined}
      />
    )
  }
}

export const AiFileIcon = hugeIcon(shapes.AiFileIcon)
export const Alert02Icon = hugeIcon(shapes.Alert02Icon)
export const AnchorIcon = hugeIcon(shapes.AnchorIcon)
export const AppWindowIcon = hugeIcon(shapes.AppWindowIcon)
export const Archive02Icon = hugeIcon(shapes.Archive02Icon)
export const ArchiveArrowUpIcon = hugeIcon(shapes.ArchiveArrowUpIcon)
export const ArrowDown01Icon = hugeIcon(shapes.ArrowDown01Icon)
export const ArrowExpand01Icon = hugeIcon(shapes.ArrowExpand01Icon)
export const ArrowLeft01Icon = hugeIcon(shapes.ArrowLeft01Icon)
export const ArrowRight01Icon = hugeIcon(shapes.ArrowRight01Icon)
export const ArrowShrink02Icon = hugeIcon(shapes.ArrowShrink02Icon)
export const ArrowUp01Icon = hugeIcon(shapes.ArrowUp01Icon)
export const ArrowUp02Icon = hugeIcon(shapes.ArrowUp02Icon)
export const ArrowUpLeft01Icon = hugeIcon(shapes.ArrowUpLeft01Icon)
export const ArrowUpRight01Icon = hugeIcon(shapes.ArrowUpRight01Icon)
export const AtomIcon = hugeIcon(shapes.AtomIcon)
export const Attachment01Icon = hugeIcon(shapes.Attachment01Icon)
export const BatteryEmptyIcon = hugeIcon(shapes.BatteryEmptyIcon)
export const BatteryFullIcon = hugeIcon(shapes.BatteryFullIcon)
export const BatteryLowIcon = hugeIcon(shapes.BatteryLowIcon)
export const BatteryMedium01Icon = hugeIcon(shapes.BatteryMedium01Icon)
export const BatteryMedium02Icon = hugeIcon(shapes.BatteryMedium02Icon)
export const BellIcon = hugeIcon(shapes.BellIcon)
export const BookOpenIcon = hugeIcon(shapes.BookOpenIcon)
export const BoxIcon = hugeIcon(shapes.BoxIcon)
export const BracesIcon = hugeIcon(shapes.BracesIcon)
export const BrainIcon = hugeIcon(shapes.BrainIcon)
export const BriefcaseIcon = hugeIcon(shapes.BriefcaseIcon)
export const BrowserIcon = hugeIcon(shapes.BrowserIcon)
export const BubbleChatIcon = hugeIcon(shapes.BubbleChatIcon)
export const BugIcon = hugeIcon(shapes.BugIcon)
export const CalendarIcon = hugeIcon(shapes.CalendarIcon)
export const CameraIcon = hugeIcon(shapes.CameraIcon)
export const Cancel01Icon = hugeIcon(shapes.Cancel01Icon)
export const CancelCircleIcon = hugeIcon(shapes.CancelCircleIcon)
export const ChartHistogramIcon = hugeIcon(shapes.ChartHistogramIcon)
export const ChartLineIcon = hugeIcon(shapes.ChartLineIcon)
export const ChartScatterIcon = hugeIcon(shapes.ChartScatterIcon)
export const CheckmarkCircle02Icon = hugeIcon(shapes.CheckmarkCircle02Icon)
export const CheckmarkSquare02Icon = hugeIcon(shapes.CheckmarkSquare02Icon)
export const CircleIcon = hugeIcon(shapes.CircleIcon)
export const CircleSlashIcon = hugeIcon(shapes.CircleSlashIcon)
export const Clock01Icon = hugeIcon(shapes.Clock01Icon)
export const CloudIcon = hugeIcon(shapes.CloudIcon)
export const CodeIcon = hugeIcon(shapes.CodeIcon)
export const CodeXmlIcon = hugeIcon(shapes.CodeXmlIcon)
export const CoffeeIcon = hugeIcon(shapes.CoffeeIcon)
export const Comment01Icon = hugeIcon(shapes.Comment01Icon)
export const CompassIcon = hugeIcon(shapes.CompassIcon)
export const ComputerIcon = hugeIcon(shapes.ComputerIcon)
export const ContainerIcon = hugeIcon(shapes.ContainerIcon)
export const Copy01Icon = hugeIcon(shapes.Copy01Icon)
export const CpuIcon = hugeIcon(shapes.CpuIcon)
export const CreditCardIcon = hugeIcon(shapes.CreditCardIcon)
export const CropIcon = hugeIcon(shapes.CropIcon)
export const DashboardSquare01Icon = hugeIcon(shapes.DashboardSquare01Icon)
export const DatabaseIcon = hugeIcon(shapes.DatabaseIcon)
export const Delete02Icon = hugeIcon(shapes.Delete02Icon)
export const DiceFaces05Icon = hugeIcon(shapes.DiceFaces05Icon)
export const DnaIcon = hugeIcon(shapes.DnaIcon)
export const DragDropVerticalIcon = hugeIcon(shapes.DragDropVerticalIcon)
export const File01Icon = hugeIcon(shapes.File01Icon)
export const FileCodeIcon = hugeIcon(shapes.FileCodeIcon)
export const FileTextIcon = hugeIcon(shapes.FileTextIcon)
export const Files01Icon = hugeIcon(shapes.Files01Icon)
export const FilmIcon = hugeIcon(shapes.FilmIcon)
export const FlagIcon = hugeIcon(shapes.FlagIcon)
export const FlameIcon = hugeIcon(shapes.FlameIcon)
export const FlashIcon = hugeIcon(shapes.FlashIcon)
export const FlaskConicalIcon = hugeIcon(shapes.FlaskConicalIcon)
export const Folder01Icon = hugeIcon(shapes.Folder01Icon)
export const FolderGit2Icon = hugeIcon(shapes.FolderGit2Icon)
export const FolderOpenIcon = hugeIcon(shapes.FolderOpenIcon)
export const FunctionIcon = hugeIcon(shapes.FunctionIcon)
export const GameController03Icon = hugeIcon(shapes.GameController03Icon)
export const GaugeIcon = hugeIcon(shapes.GaugeIcon)
export const GhostIcon = hugeIcon(shapes.GhostIcon)
export const GlobeIcon = hugeIcon(shapes.GlobeIcon)
export const GraduationCapIcon = hugeIcon(shapes.GraduationCapIcon)
export const HammerIcon = hugeIcon(shapes.HammerIcon)
export const HardDriveIcon = hugeIcon(shapes.HardDriveIcon)
export const HeartIcon = hugeIcon(shapes.HeartIcon)
export const HierarchySquare01Icon = hugeIcon(shapes.HierarchySquare01Icon)
export const HistoryIcon = hugeIcon(shapes.HistoryIcon)
export const HouseIcon = hugeIcon(shapes.HouseIcon)
export const Image01Icon = hugeIcon(shapes.Image01Icon)
export const ImageNotFound01Icon = hugeIcon(shapes.ImageNotFound01Icon)
export const InformationCircleIcon = hugeIcon(shapes.InformationCircleIcon)
export const KeyIcon = hugeIcon(shapes.KeyIcon)
export const KeyboardIcon = hugeIcon(shapes.KeyboardIcon)
export const LanguagesIcon = hugeIcon(shapes.LanguagesIcon)
export const LaptopIcon = hugeIcon(shapes.LaptopIcon)
export const LayersIcon = hugeIcon(shapes.LayersIcon)
export const LeafIcon = hugeIcon(shapes.LeafIcon)
export const LeftToRightListBulletIcon = hugeIcon(shapes.LeftToRightListBulletIcon)
export const LightbulbIcon = hugeIcon(shapes.LightbulbIcon)
export const Link01Icon = hugeIcon(shapes.Link01Icon)
export const LinkSquare02Icon = hugeIcon(shapes.LinkSquare02Icon)
export const LockIcon = hugeIcon(shapes.LockIcon)
export const MailIcon = hugeIcon(shapes.MailIcon)
export const MapPinIcon = hugeIcon(shapes.MapPinIcon)
export const MegaphoneIcon = hugeIcon(shapes.MegaphoneIcon)
export const MessageCircleIcon = hugeIcon(shapes.MessageCircleIcon)
export const MinusSignCircleIcon = hugeIcon(shapes.MinusSignCircleIcon)
export const Moon02Icon = hugeIcon(shapes.Moon02Icon)
export const MoreVerticalIcon = hugeIcon(shapes.MoreVerticalIcon)
export const MusicIcon = hugeIcon(shapes.MusicIcon)
export const NetworkIcon = hugeIcon(shapes.NetworkIcon)
export const NewspaperIcon = hugeIcon(shapes.NewspaperIcon)
export const NotebookIcon = hugeIcon(shapes.NotebookIcon)
export const OrbitIcon = hugeIcon(shapes.OrbitIcon)
export const PackageIcon = hugeIcon(shapes.PackageIcon)
export const PaintBrush01Icon = hugeIcon(shapes.PaintBrush01Icon)
export const PaletteIcon = hugeIcon(shapes.PaletteIcon)
export const PauseIcon = hugeIcon(shapes.PauseIcon)
export const PawPrintIcon = hugeIcon(shapes.PawPrintIcon)
export const PenToolIcon = hugeIcon(shapes.PenToolIcon)
export const PencilIcon = hugeIcon(shapes.PencilIcon)
export const Edit03Icon = hugeIcon(shapes.Edit03Icon)
export const PencilEdit02Icon = hugeIcon(shapes.PencilEdit02Icon)
export const PieChartIcon = hugeIcon(shapes.PieChartIcon)
export const PinIcon = hugeIcon(shapes.PinIcon)
export const PlayIcon = hugeIcon(shapes.PlayIcon)
export const PlugIcon = hugeIcon(shapes.PlugIcon)
export const Plug01Icon = hugeIcon(shapes.Plug01Icon)
export const PlusSignIcon = hugeIcon(shapes.PlusSignIcon)
export const PuzzleIcon = hugeIcon(shapes.PuzzleIcon)
export const RadioButtonIcon = hugeIcon(shapes.RadioButtonIcon)
export const Refresh01Icon = hugeIcon(shapes.Refresh01Icon)
export const Robot01Icon = hugeIcon(shapes.Robot01Icon)
export const RocketIcon = hugeIcon(shapes.RocketIcon)
export const Search01Icon = hugeIcon(shapes.Search01Icon)
export const Settings01Icon = hugeIcon(shapes.Settings01Icon)
export const ShapesIcon = hugeIcon(shapes.ShapesIcon)
export const ShieldCheckIcon = hugeIcon(shapes.ShieldCheckIcon)
export const ShieldOffIcon = hugeIcon(shapes.ShieldOffIcon)
export const ShieldQuestionMarkIcon = hugeIcon(shapes.ShieldQuestionMarkIcon)
export const ShoppingCartIcon = hugeIcon(shapes.ShoppingCartIcon)
export const SidebarLeftIcon = hugeIcon(shapes.SidebarLeftIcon)
export const SidebarLeft01Icon = hugeIcon(shapes.SidebarLeft01Icon)
export const SmartphoneIcon = hugeIcon(shapes.SmartphoneIcon)
export const SourceCodeSquareIcon = hugeIcon(shapes.SourceCodeSquareIcon)
export const SparklesIcon = hugeIcon(shapes.SparklesIcon)
export const SquareIcon = hugeIcon(shapes.SquareIcon)
export const SquareTerminalIcon = hugeIcon(shapes.SquareTerminalIcon)
export const StarIcon = hugeIcon(shapes.StarIcon)
export const StopIcon = hugeIcon(shapes.StopIcon)
export const StoreIcon = hugeIcon(shapes.StoreIcon)
export const Sun03Icon = hugeIcon(shapes.Sun03Icon)
export const SwatchBookIcon = hugeIcon(shapes.SwatchBookIcon)
export const SwordIcon = hugeIcon(shapes.SwordIcon)
export const TableIcon = hugeIcon(shapes.TableIcon)
export const TargetIcon = hugeIcon(shapes.TargetIcon)
export const Tick02Icon = hugeIcon(shapes.Tick02Icon)
export const ToolboxIcon = hugeIcon(shapes.ToolboxIcon)
export const TrophyIcon = hugeIcon(shapes.TrophyIcon)
export const UndoIcon = hugeIcon(shapes.UndoIcon)
export const Unlink01Icon = hugeIcon(shapes.Unlink01Icon)
export const Upload04Icon = hugeIcon(shapes.Upload04Icon)
export const UserIcon = hugeIcon(shapes.UserIcon)
export const UserAdd01Icon = hugeIcon(shapes.UserAdd01Icon)
export const UserGroupIcon = hugeIcon(shapes.UserGroupIcon)
export const UsersIcon = hugeIcon(shapes.UsersIcon)
export const ViewIcon = hugeIcon(shapes.ViewIcon)
export const VolumeHighIcon = hugeIcon(shapes.VolumeHighIcon)
export const VolumeMute02Icon = hugeIcon(shapes.VolumeMute02Icon)
export const WalletIcon = hugeIcon(shapes.WalletIcon)
export const WrenchIcon = hugeIcon(shapes.WrenchIcon)
export const ZoomInAreaIcon = hugeIcon(shapes.ZoomInAreaIcon)
export const ZoomOutAreaIcon = hugeIcon(shapes.ZoomOutAreaIcon)

export const ArrowTurnBackwardIcon = hugeIcon(shapes.ArrowTurnBackwardIcon)

export const CheckListIcon = hugeIcon(shapes.CheckListIcon)

export const KanbanIcon = hugeIcon(shapes.KanbanIcon)

export const Tag01Icon = hugeIcon(shapes.Tag01Icon)

export const UserCircleIcon = hugeIcon(shapes.UserCircleIcon)

export const ListFilterIcon = hugeIcon(shapes.ListFilterIcon)

export const FilterHorizontalIcon = hugeIcon(shapes.FilterHorizontalIcon)

export const FolderAddIcon = hugeIcon(shapes.FolderAddIcon)

export const ViewOffIcon = hugeIcon(shapes.ViewOffIcon)

export const ArrowLeft02Icon = hugeIcon(shapes.ArrowLeft02Icon)

export const ArrowRight02Icon = hugeIcon(shapes.ArrowRight02Icon)

export const TextBoldIcon = hugeIcon(shapes.TextBoldIcon)

export const TextItalicIcon = hugeIcon(shapes.TextItalicIcon)

export const ArrowDown02Icon = hugeIcon(shapes.ArrowDown02Icon)

export const SignalFullIcon = hugeIcon(shapes.SignalFullIcon)

export const SignalHighIcon = hugeIcon(shapes.SignalHighIcon)

export const SignalMediumIcon = hugeIcon(shapes.SignalMediumIcon)

export const SignalLowIcon = hugeIcon(shapes.SignalLowIcon)

export const SignalNoIcon = hugeIcon(shapes.SignalNoIcon)

export const TextStrikethroughIcon = hugeIcon(shapes.TextStrikethroughIcon)

export const TextWrapIcon = hugeIcon(shapes.TextWrapIcon)

export const Heading01Icon = hugeIcon(shapes.Heading01Icon)

export const Heading02Icon = hugeIcon(shapes.Heading02Icon)

export const Heading03Icon = hugeIcon(shapes.Heading03Icon)

export const LeftToRightListNumberIcon = hugeIcon(shapes.LeftToRightListNumberIcon)

export const QuoteDownIcon = hugeIcon(shapes.QuoteDownIcon)

export const MinusSignIcon = hugeIcon(shapes.MinusSignIcon)

export const Download04Icon = hugeIcon(shapes.Download04Icon)

// A glyph as an SVG data URL for CSS masks, where a component can't render (inside Pierre's shadow
// roots). Drawn as the components draw it: 1.125× its slot, with a 1.333px line at `size`.
function hugeIconMask(shape: IconSvgElement, size: number) {
  const line = (1.333333 * 21.333333) / size
  const paths = shape
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs)
        .filter(([name]) => name !== 'key')
        .map(([name, value]) => {
          const attr = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
          return `${attr}="${name === 'strokeWidth' ? line : value === 'currentColor' ? 'black' : value}"`
        })
      return `<${tag} ${props.join(' ')}/>`
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="1.333333 1.333333 21.333333 21.333333" fill="none">${paths}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export const hugeIconMasks = {
  arrowUp03: hugeIconMask(shapes.ArrowUp03Icon, 12),
  arrowDown03: hugeIconMask(shapes.ArrowDown03Icon, 12),
  arrowUpDown: hugeIconMask(shapes.ArrowUpDownIcon, 12),
  bubbleChat: hugeIconMask(shapes.BubbleChatIcon, 12),
  search01: hugeIconMask(shapes.Search01Icon, 12),
}
