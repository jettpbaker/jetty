import type { ComponentType } from 'react'

import {
  Alert02Icon as Alert02Shape,
  AnchorIcon as AnchorShape,
  AppWindowIcon as AppWindowShape,
  Archive02Icon as Archive02Shape,
  ArchiveArrowUpIcon as ArchiveArrowUpShape,
  ArrowDown01Icon as ArrowDown01Shape,
  ArrowExpandIcon as ArrowExpandShape,
  ArrowExpand01Icon as ArrowExpand01Shape,
  ArrowLeft01Icon as ArrowLeft01Shape,
  ArrowMoveDownRightIcon as ArrowMoveDownRightShape,
  ArrowRight01Icon as ArrowRight01Shape,
  ArrowShrinkIcon as ArrowShrinkShape,
  ArrowShrink02Icon as ArrowShrink02Shape,
  ArrowUp01Icon as ArrowUp01Shape,
  ArrowUp02Icon as ArrowUp02Shape,
  ArrowUpLeft01Icon as ArrowUpLeft01Shape,
  ArrowUpRight01Icon as ArrowUpRight01Shape,
  AtomIcon as AtomShape,
  Attachment01Icon as Attachment01Shape,
  BatteryEmptyIcon as BatteryEmptyShape,
  BatteryFullIcon as BatteryFullShape,
  BatteryLowIcon as BatteryLowShape,
  BatteryMedium01Icon as BatteryMedium01Shape,
  BatteryMedium02Icon as BatteryMedium02Shape,
  BellIcon as BellShape,
  BookOpenIcon as BookOpenShape,
  BoxIcon as BoxShape,
  BracesIcon as BracesShape,
  BrainIcon as BrainShape,
  BriefcaseIcon as BriefcaseShape,
  BrowserIcon as BrowserShape,
  BubbleChatIcon as BubbleChatShape,
  BugIcon as BugShape,
  CalendarIcon as CalendarShape,
  CameraIcon as CameraShape,
  Cancel01Icon as Cancel01Shape,
  CancelCircleIcon as CancelCircleShape,
  ChartHistogramIcon as ChartHistogramShape,
  ChartLineIcon as ChartLineShape,
  ChartScatterIcon as ChartScatterShape,
  CheckmarkCircle02Icon as CheckmarkCircle02Shape,
  CheckmarkSquare02Icon as CheckmarkSquare02Shape,
  CircleIcon as CircleShape,
  CircleSlashIcon as CircleSlashShape,
  Clock01Icon as Clock01Shape,
  CloudIcon as CloudShape,
  CodeIcon as CodeShape,
  CodeXmlIcon as CodeXmlShape,
  CoffeeIcon as CoffeeShape,
  Comment01Icon as Comment01Shape,
  CompassIcon as CompassShape,
  ComputerIcon as ComputerShape,
  ContainerIcon as ContainerShape,
  Copy01Icon as Copy01Shape,
  CpuIcon as CpuShape,
  CreditCardIcon as CreditCardShape,
  CropIcon as CropShape,
  DashboardSquare01Icon as DashboardSquare01Shape,
  DatabaseIcon as DatabaseShape,
  Delete02Icon as Delete02Shape,
  DiceFaces05Icon as DiceFaces05Shape,
  DnaIcon as DnaShape,
  DragDropVerticalIcon as DragDropVerticalShape,
  File01Icon as File01Shape,
  FileCodeIcon as FileCodeShape,
  FileTextIcon as FileTextShape,
  FilmIcon as FilmShape,
  FlagIcon as FlagShape,
  FlameIcon as FlameShape,
  FlashIcon as FlashShape,
  FlaskConicalIcon as FlaskConicalShape,
  Folder01Icon as Folder01Shape,
  FolderOpenIcon as FolderOpenShape,
  FunctionIcon as FunctionShape,
  GameController03Icon as GameController03Shape,
  GaugeIcon as GaugeShape,
  GhostIcon as GhostShape,
  GlobeIcon as GlobeShape,
  GraduationCapIcon as GraduationCapShape,
  HammerIcon as HammerShape,
  HardDriveIcon as HardDriveShape,
  HeartIcon as HeartShape,
  HouseIcon as HouseShape,
  Image01Icon as Image01Shape,
  ImageNotFound01Icon as ImageNotFound01Shape,
  InformationCircleIcon as InformationCircleShape,
  KeyIcon as KeyShape,
  KeyboardIcon as KeyboardShape,
  LanguagesIcon as LanguagesShape,
  LaptopIcon as LaptopShape,
  LayersIcon as LayersShape,
  LeafIcon as LeafShape,
  LeftToRightListBulletIcon as LeftToRightListBulletShape,
  LightbulbIcon as LightbulbShape,
  Link01Icon as Link01Shape,
  LinkSquare02Icon as LinkSquare02Shape,
  LockIcon as LockShape,
  MailIcon as MailShape,
  MapPinIcon as MapPinShape,
  MegaphoneIcon as MegaphoneShape,
  MessageCircleIcon as MessageCircleShape,
  MinusSignCircleIcon as MinusSignCircleShape,
  Moon02Icon as Moon02Shape,
  MoreVerticalIcon as MoreVerticalShape,
  MusicIcon as MusicShape,
  NetworkIcon as NetworkShape,
  NewspaperIcon as NewspaperShape,
  NotebookIcon as NotebookShape,
  OrbitIcon as OrbitShape,
  PackageIcon as PackageShape,
  PaintBrush01Icon as PaintBrush01Shape,
  PaletteIcon as PaletteShape,
  PauseIcon as PauseShape,
  PawPrintIcon as PawPrintShape,
  PenToolIcon as PenToolShape,
  PencilIcon as PencilShape,
  PencilEdit01Icon as PencilEdit01Shape,
  PencilEdit02Icon as PencilEdit02Shape,
  PieChartIcon as PieChartShape,
  PinIcon as PinShape,
  PlayIcon as PlayShape,
  PlugIcon as PlugShape,
  Plug01Icon as Plug01Shape,
  PlusSignIcon as PlusSignShape,
  PuzzleIcon as PuzzleShape,
  RadioButtonIcon as RadioButtonShape,
  RefreshIcon as RefreshShape,
  Robot01Icon as Robot01Shape,
  RocketIcon as RocketShape,
  Search01Icon as Search01Shape,
  Settings01Icon as Settings01Shape,
  ShapesIcon as ShapesShape,
  ShieldCheckIcon as ShieldCheckShape,
  ShieldOffIcon as ShieldOffShape,
  ShieldQuestionMarkIcon as ShieldQuestionMarkShape,
  ShoppingCartIcon as ShoppingCartShape,
  SidebarLeftIcon as SidebarLeftShape,
  SidebarLeft01Icon as SidebarLeft01Shape,
  SlidersHorizontalIcon as SlidersHorizontalShape,
  SmartphoneIcon as SmartphoneShape,
  SourceCodeSquareIcon as SourceCodeSquareShape,
  SparklesIcon as SparklesShape,
  SquareIcon as SquareShape,
  SquareTerminalIcon as SquareTerminalShape,
  SquareUnlock02Icon as SquareUnlock02Shape,
  StarIcon as StarShape,
  StopIcon as StopShape,
  StoreIcon as StoreShape,
  Sun03Icon as Sun03Shape,
  SwatchBookIcon as SwatchBookShape,
  SwordIcon as SwordShape,
  TableIcon as TableShape,
  TargetIcon as TargetShape,
  Tick02Icon as Tick02Shape,
  ToolboxIcon as ToolboxShape,
  TrophyIcon as TrophyShape,
  UndoIcon as UndoShape,
  Unlink01Icon as Unlink01Shape,
  Upload04Icon as Upload04Shape,
  UserIcon as UserShape,
  UserAdd01Icon as UserAdd01Shape,
  UserGroupIcon as UserGroupShape,
  UsersIcon as UsersShape,
  ViewIcon as ViewShape,
  VolumeHighIcon as VolumeHighShape,
  VolumeMute02Icon as VolumeMute02Shape,
  WalletIcon as WalletShape,
  WrenchIcon as WrenchShape,
  ZoomInAreaIcon as ZoomInAreaShape,
  ZoomOutAreaIcon as ZoomOutAreaShape,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'

export type IconProps = Omit<
  HugeiconsIconProps,
  'icon' | 'strokeWidth' | 'absoluteStrokeWidth' | 'viewBox'
> & { filled?: boolean }
export type Icon = ComponentType<IconProps>

function hugeIcon(icon: IconSvgElement): Icon {
  return function Icon({ filled = false, ...props }: IconProps) {
    return (
      <HugeiconsIcon
        size={16}
        aria-hidden='true'
        {...props}
        icon={icon}
        viewBox='1.333333 1.333333 21.333333 21.333333'
        data-icon-pack='huge'
        data-filled={filled || undefined}
      />
    )
  }
}

export const Alert02Icon = /* @__PURE__ */ hugeIcon(Alert02Shape)
export const AnchorIcon = /* @__PURE__ */ hugeIcon(AnchorShape)
export const AppWindowIcon = /* @__PURE__ */ hugeIcon(AppWindowShape)
export const Archive02Icon = /* @__PURE__ */ hugeIcon(Archive02Shape)
export const ArchiveArrowUpIcon = /* @__PURE__ */ hugeIcon(ArchiveArrowUpShape)
export const ArrowDown01Icon = /* @__PURE__ */ hugeIcon(ArrowDown01Shape)
export const ArrowExpandIcon = /* @__PURE__ */ hugeIcon(ArrowExpandShape)
export const ArrowExpand01Icon = /* @__PURE__ */ hugeIcon(ArrowExpand01Shape)
export const ArrowLeft01Icon = /* @__PURE__ */ hugeIcon(ArrowLeft01Shape)
export const ArrowMoveDownRightIcon = /* @__PURE__ */ hugeIcon(ArrowMoveDownRightShape)
export const ArrowRight01Icon = /* @__PURE__ */ hugeIcon(ArrowRight01Shape)
export const ArrowShrinkIcon = /* @__PURE__ */ hugeIcon(ArrowShrinkShape)
export const ArrowShrink02Icon = /* @__PURE__ */ hugeIcon(ArrowShrink02Shape)
export const ArrowUp01Icon = /* @__PURE__ */ hugeIcon(ArrowUp01Shape)
export const ArrowUp02Icon = /* @__PURE__ */ hugeIcon(ArrowUp02Shape)
export const ArrowUpLeft01Icon = /* @__PURE__ */ hugeIcon(ArrowUpLeft01Shape)
export const ArrowUpRight01Icon = /* @__PURE__ */ hugeIcon(ArrowUpRight01Shape)
export const AtomIcon = /* @__PURE__ */ hugeIcon(AtomShape)
export const Attachment01Icon = /* @__PURE__ */ hugeIcon(Attachment01Shape)
export const BatteryEmptyIcon = /* @__PURE__ */ hugeIcon(BatteryEmptyShape)
export const BatteryFullIcon = /* @__PURE__ */ hugeIcon(BatteryFullShape)
export const BatteryLowIcon = /* @__PURE__ */ hugeIcon(BatteryLowShape)
export const BatteryMedium01Icon = /* @__PURE__ */ hugeIcon(BatteryMedium01Shape)
export const BatteryMedium02Icon = /* @__PURE__ */ hugeIcon(BatteryMedium02Shape)
export const BellIcon = /* @__PURE__ */ hugeIcon(BellShape)
export const BookOpenIcon = /* @__PURE__ */ hugeIcon(BookOpenShape)
export const BoxIcon = /* @__PURE__ */ hugeIcon(BoxShape)
export const BracesIcon = /* @__PURE__ */ hugeIcon(BracesShape)
export const BrainIcon = /* @__PURE__ */ hugeIcon(BrainShape)
export const BriefcaseIcon = /* @__PURE__ */ hugeIcon(BriefcaseShape)
export const BrowserIcon = /* @__PURE__ */ hugeIcon(BrowserShape)
export const BubbleChatIcon = /* @__PURE__ */ hugeIcon(BubbleChatShape)
export const BugIcon = /* @__PURE__ */ hugeIcon(BugShape)
export const CalendarIcon = /* @__PURE__ */ hugeIcon(CalendarShape)
export const CameraIcon = /* @__PURE__ */ hugeIcon(CameraShape)
export const Cancel01Icon = /* @__PURE__ */ hugeIcon(Cancel01Shape)
export const CancelCircleIcon = /* @__PURE__ */ hugeIcon(CancelCircleShape)
export const ChartHistogramIcon = /* @__PURE__ */ hugeIcon(ChartHistogramShape)
export const ChartLineIcon = /* @__PURE__ */ hugeIcon(ChartLineShape)
export const ChartScatterIcon = /* @__PURE__ */ hugeIcon(ChartScatterShape)
export const CheckmarkCircle02Icon = /* @__PURE__ */ hugeIcon(CheckmarkCircle02Shape)
export const CheckmarkSquare02Icon = /* @__PURE__ */ hugeIcon(CheckmarkSquare02Shape)
export const CircleIcon = /* @__PURE__ */ hugeIcon(CircleShape)
export const CircleSlashIcon = /* @__PURE__ */ hugeIcon(CircleSlashShape)
export const Clock01Icon = /* @__PURE__ */ hugeIcon(Clock01Shape)
export const CloudIcon = /* @__PURE__ */ hugeIcon(CloudShape)
export const CodeIcon = /* @__PURE__ */ hugeIcon(CodeShape)
export const CodeXmlIcon = /* @__PURE__ */ hugeIcon(CodeXmlShape)
export const CoffeeIcon = /* @__PURE__ */ hugeIcon(CoffeeShape)
export const Comment01Icon = /* @__PURE__ */ hugeIcon(Comment01Shape)
export const CompassIcon = /* @__PURE__ */ hugeIcon(CompassShape)
export const ComputerIcon = /* @__PURE__ */ hugeIcon(ComputerShape)
export const ContainerIcon = /* @__PURE__ */ hugeIcon(ContainerShape)
export const Copy01Icon = /* @__PURE__ */ hugeIcon(Copy01Shape)
export const CpuIcon = /* @__PURE__ */ hugeIcon(CpuShape)
export const CreditCardIcon = /* @__PURE__ */ hugeIcon(CreditCardShape)
export const CropIcon = /* @__PURE__ */ hugeIcon(CropShape)
export const DashboardSquare01Icon = /* @__PURE__ */ hugeIcon(DashboardSquare01Shape)
export const DatabaseIcon = /* @__PURE__ */ hugeIcon(DatabaseShape)
export const Delete02Icon = /* @__PURE__ */ hugeIcon(Delete02Shape)
export const DiceFaces05Icon = /* @__PURE__ */ hugeIcon(DiceFaces05Shape)
export const DnaIcon = /* @__PURE__ */ hugeIcon(DnaShape)
export const DragDropVerticalIcon = /* @__PURE__ */ hugeIcon(DragDropVerticalShape)
export const File01Icon = /* @__PURE__ */ hugeIcon(File01Shape)
export const FileCodeIcon = /* @__PURE__ */ hugeIcon(FileCodeShape)
export const FileTextIcon = /* @__PURE__ */ hugeIcon(FileTextShape)
export const FilmIcon = /* @__PURE__ */ hugeIcon(FilmShape)
export const FlagIcon = /* @__PURE__ */ hugeIcon(FlagShape)
export const FlameIcon = /* @__PURE__ */ hugeIcon(FlameShape)
export const FlashIcon = /* @__PURE__ */ hugeIcon(FlashShape)
export const FlaskConicalIcon = /* @__PURE__ */ hugeIcon(FlaskConicalShape)
export const Folder01Icon = /* @__PURE__ */ hugeIcon(Folder01Shape)
export const FolderOpenIcon = /* @__PURE__ */ hugeIcon(FolderOpenShape)
export const FunctionIcon = /* @__PURE__ */ hugeIcon(FunctionShape)
export const GameController03Icon = /* @__PURE__ */ hugeIcon(GameController03Shape)
export const GaugeIcon = /* @__PURE__ */ hugeIcon(GaugeShape)
export const GhostIcon = /* @__PURE__ */ hugeIcon(GhostShape)
export const GlobeIcon = /* @__PURE__ */ hugeIcon(GlobeShape)
export const GraduationCapIcon = /* @__PURE__ */ hugeIcon(GraduationCapShape)
export const HammerIcon = /* @__PURE__ */ hugeIcon(HammerShape)
export const HardDriveIcon = /* @__PURE__ */ hugeIcon(HardDriveShape)
export const HeartIcon = /* @__PURE__ */ hugeIcon(HeartShape)
export const HouseIcon = /* @__PURE__ */ hugeIcon(HouseShape)
export const Image01Icon = /* @__PURE__ */ hugeIcon(Image01Shape)
export const ImageNotFound01Icon = /* @__PURE__ */ hugeIcon(ImageNotFound01Shape)
export const InformationCircleIcon = /* @__PURE__ */ hugeIcon(InformationCircleShape)
export const KeyIcon = /* @__PURE__ */ hugeIcon(KeyShape)
export const KeyboardIcon = /* @__PURE__ */ hugeIcon(KeyboardShape)
export const LanguagesIcon = /* @__PURE__ */ hugeIcon(LanguagesShape)
export const LaptopIcon = /* @__PURE__ */ hugeIcon(LaptopShape)
export const LayersIcon = /* @__PURE__ */ hugeIcon(LayersShape)
export const LeafIcon = /* @__PURE__ */ hugeIcon(LeafShape)
export const LeftToRightListBulletIcon = /* @__PURE__ */ hugeIcon(LeftToRightListBulletShape)
export const LightbulbIcon = /* @__PURE__ */ hugeIcon(LightbulbShape)
export const Link01Icon = /* @__PURE__ */ hugeIcon(Link01Shape)
export const LinkSquare02Icon = /* @__PURE__ */ hugeIcon(LinkSquare02Shape)
export const LockIcon = /* @__PURE__ */ hugeIcon(LockShape)
export const MailIcon = /* @__PURE__ */ hugeIcon(MailShape)
export const MapPinIcon = /* @__PURE__ */ hugeIcon(MapPinShape)
export const MegaphoneIcon = /* @__PURE__ */ hugeIcon(MegaphoneShape)
export const MessageCircleIcon = /* @__PURE__ */ hugeIcon(MessageCircleShape)
export const MinusSignCircleIcon = /* @__PURE__ */ hugeIcon(MinusSignCircleShape)
export const Moon02Icon = /* @__PURE__ */ hugeIcon(Moon02Shape)
export const MoreVerticalIcon = /* @__PURE__ */ hugeIcon(MoreVerticalShape)
export const MusicIcon = /* @__PURE__ */ hugeIcon(MusicShape)
export const NetworkIcon = /* @__PURE__ */ hugeIcon(NetworkShape)
export const NewspaperIcon = /* @__PURE__ */ hugeIcon(NewspaperShape)
export const NotebookIcon = /* @__PURE__ */ hugeIcon(NotebookShape)
export const OrbitIcon = /* @__PURE__ */ hugeIcon(OrbitShape)
export const PackageIcon = /* @__PURE__ */ hugeIcon(PackageShape)
export const PaintBrush01Icon = /* @__PURE__ */ hugeIcon(PaintBrush01Shape)
export const PaletteIcon = /* @__PURE__ */ hugeIcon(PaletteShape)
export const PauseIcon = /* @__PURE__ */ hugeIcon(PauseShape)
export const PawPrintIcon = /* @__PURE__ */ hugeIcon(PawPrintShape)
export const PenToolIcon = /* @__PURE__ */ hugeIcon(PenToolShape)
export const PencilIcon = /* @__PURE__ */ hugeIcon(PencilShape)
export const PencilEdit01Icon = /* @__PURE__ */ hugeIcon(PencilEdit01Shape)
export const PencilEdit02Icon = /* @__PURE__ */ hugeIcon(PencilEdit02Shape)
export const PieChartIcon = /* @__PURE__ */ hugeIcon(PieChartShape)
export const PinIcon = /* @__PURE__ */ hugeIcon(PinShape)
export const PlayIcon = /* @__PURE__ */ hugeIcon(PlayShape)
export const PlugIcon = /* @__PURE__ */ hugeIcon(PlugShape)
export const Plug01Icon = /* @__PURE__ */ hugeIcon(Plug01Shape)
export const PlusSignIcon = /* @__PURE__ */ hugeIcon(PlusSignShape)
export const PuzzleIcon = /* @__PURE__ */ hugeIcon(PuzzleShape)
export const RadioButtonIcon = /* @__PURE__ */ hugeIcon(RadioButtonShape)
export const RefreshIcon = /* @__PURE__ */ hugeIcon(RefreshShape)
export const Robot01Icon = /* @__PURE__ */ hugeIcon(Robot01Shape)
export const RocketIcon = /* @__PURE__ */ hugeIcon(RocketShape)
export const Search01Icon = /* @__PURE__ */ hugeIcon(Search01Shape)
export const Settings01Icon = /* @__PURE__ */ hugeIcon(Settings01Shape)
export const ShapesIcon = /* @__PURE__ */ hugeIcon(ShapesShape)
export const ShieldCheckIcon = /* @__PURE__ */ hugeIcon(ShieldCheckShape)
export const ShieldOffIcon = /* @__PURE__ */ hugeIcon(ShieldOffShape)
export const ShieldQuestionMarkIcon = /* @__PURE__ */ hugeIcon(ShieldQuestionMarkShape)
export const ShoppingCartIcon = /* @__PURE__ */ hugeIcon(ShoppingCartShape)
export const SidebarLeftIcon = /* @__PURE__ */ hugeIcon(SidebarLeftShape)
export const SidebarLeft01Icon = /* @__PURE__ */ hugeIcon(SidebarLeft01Shape)
export const SlidersHorizontalIcon = /* @__PURE__ */ hugeIcon(SlidersHorizontalShape)
export const SmartphoneIcon = /* @__PURE__ */ hugeIcon(SmartphoneShape)
export const SourceCodeSquareIcon = /* @__PURE__ */ hugeIcon(SourceCodeSquareShape)
export const SparklesIcon = /* @__PURE__ */ hugeIcon(SparklesShape)
export const SquareIcon = /* @__PURE__ */ hugeIcon(SquareShape)
export const SquareTerminalIcon = /* @__PURE__ */ hugeIcon(SquareTerminalShape)
export const SquareUnlock02Icon = /* @__PURE__ */ hugeIcon(SquareUnlock02Shape)
export const StarIcon = /* @__PURE__ */ hugeIcon(StarShape)
export const StopIcon = /* @__PURE__ */ hugeIcon(StopShape)
export const StoreIcon = /* @__PURE__ */ hugeIcon(StoreShape)
export const Sun03Icon = /* @__PURE__ */ hugeIcon(Sun03Shape)
export const SwatchBookIcon = /* @__PURE__ */ hugeIcon(SwatchBookShape)
export const SwordIcon = /* @__PURE__ */ hugeIcon(SwordShape)
export const TableIcon = /* @__PURE__ */ hugeIcon(TableShape)
export const TargetIcon = /* @__PURE__ */ hugeIcon(TargetShape)
export const Tick02Icon = /* @__PURE__ */ hugeIcon(Tick02Shape)
export const ToolboxIcon = /* @__PURE__ */ hugeIcon(ToolboxShape)
export const TrophyIcon = /* @__PURE__ */ hugeIcon(TrophyShape)
export const UndoIcon = /* @__PURE__ */ hugeIcon(UndoShape)
export const Unlink01Icon = /* @__PURE__ */ hugeIcon(Unlink01Shape)
export const Upload04Icon = /* @__PURE__ */ hugeIcon(Upload04Shape)
export const UserIcon = /* @__PURE__ */ hugeIcon(UserShape)
export const UserAdd01Icon = /* @__PURE__ */ hugeIcon(UserAdd01Shape)
export const UserGroupIcon = /* @__PURE__ */ hugeIcon(UserGroupShape)
export const UsersIcon = /* @__PURE__ */ hugeIcon(UsersShape)
export const ViewIcon = /* @__PURE__ */ hugeIcon(ViewShape)
export const VolumeHighIcon = /* @__PURE__ */ hugeIcon(VolumeHighShape)
export const VolumeMute02Icon = /* @__PURE__ */ hugeIcon(VolumeMute02Shape)
export const WalletIcon = /* @__PURE__ */ hugeIcon(WalletShape)
export const WrenchIcon = /* @__PURE__ */ hugeIcon(WrenchShape)
export const ZoomInAreaIcon = /* @__PURE__ */ hugeIcon(ZoomInAreaShape)
export const ZoomOutAreaIcon = /* @__PURE__ */ hugeIcon(ZoomOutAreaShape)
