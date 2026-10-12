import type { EffortLevel } from '@jetty/shared/events'

import { IconLightningBolt as IconLightningBoltFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconLightningBolt'
import { IconPause as IconPauseFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconPause'
import { IconPin as IconPinFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconPin'
import { IconPlay as IconPlayFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconPlay'
import { IconSidebarSimpleLeftWide as IconSidebarSimpleLeftWideFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconSidebarSimpleLeftWide'
import { IconStop as IconStopFilled } from '@central-icons-react/round-filled-radius-3-stroke-2/IconStop'
import { IconAddImage } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconAddImage'
import { IconAiBotHead } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconAiBotHead'
import { IconAnalytics } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconAnalytics'
import { IconArchive } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArchive'
import { IconArrowDown } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowDown'
import { IconArrowOutOfBox } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowOutOfBox'
import { IconArrowRotateClockwise } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowRotateClockwise'
import { IconArrowRotateCounterClockwise } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowRotateCounterClockwise'
import { IconArrowShareLeft } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowShareLeft'
import { IconArrowsLeftRight } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowsLeftRight'
import { IconArrowUp } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowUp'
import { IconArrowUpLeft } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowUpLeft'
import { IconArrowUpRight } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconArrowUpRight'
import { IconAtom } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconAtom'
import { IconBell2 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBell2'
import { IconBold } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBold'
import { IconBranchSimple } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBranchSimple'
import { IconBrokenChainLink1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBrokenChainLink1'
import { IconBubbleDots } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBubbleDots'
import { IconBubbles } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconBubbles'
import { IconCalendarClock } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCalendarClock'
import { IconChainLink4 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChainLink4'
import { IconChanges } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChanges'
import { IconChecklist } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChecklist'
import { IconCheckmark1Small } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCheckmark1Small'
import { IconChevronDownSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChevronDownSmall'
import { IconChevronLeftSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChevronLeftSmall'
import { IconChevronRightSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChevronRightSmall'
import { IconChevronTopSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconChevronTopSmall'
import { IconCircleCheck } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCircleCheck'
import { IconCircleInfo } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCircleInfo'
import { IconCirclePlaceholderOff } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCirclePlaceholderOff'
import { IconCirclePlaceholderOn } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCirclePlaceholderOn'
import { IconCircleX } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCircleX'
import { IconCloseQuote1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCloseQuote1'
import { IconCode } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCode'
import { IconCommits } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCommits'
import { IconConcise } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconConcise'
import { IconCrop } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCrop'
import { IconCrossSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconCrossSmall'
import { IconDivider } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconDivider'
import { IconDotGrid1x3Vertical } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconDotGrid1x3Vertical'
import { IconDotGrid2x3 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconDotGrid2x3'
import { IconDraft } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconDraft'
import { IconEditSmall1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconEditSmall1'
import { IconExclamationCircle } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconExclamationCircle'
import { IconExpand45 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconExpand45'
import { IconFileBend } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFileBend'
import { IconFileJpg } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFileJpg'
import { IconFilePdf } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFilePdf'
import { IconFilePng } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFilePng'
import { IconFiles } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFiles'
import { IconFileZip } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFileZip'
import { IconFilter2 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFilter2'
import { IconFolder1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFolder1'
import { IconFolderAddLeft } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFolderAddLeft'
import { IconFolderOpen } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFolderOpen'
import { IconFolders } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconFolders'
import { IconH1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconH1'
import { IconH2 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconH2'
import { IconH3 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconH3'
import { IconImages1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconImages1'
import { IconImport } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconImport'
import { IconItalic } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconItalic'
import { IconKeyboard } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconKeyboard'
import { IconLightningBolt } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconLightningBolt'
import { IconLinebreak } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconLinebreak'
import { IconListBullets } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconListBullets'
import { IconMacbook } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconMacbook'
import { IconMagicBook } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconMagicBook'
import { IconMagnifyingGlass2 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconMagnifyingGlass2'
import { IconMerged } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconMerged'
import { IconMinimize45 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconMinimize45'
import { IconNewspaper } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconNewspaper'
import { IconNumberedList } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconNumberedList'
import { IconPaintBrush } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPaintBrush'
import { IconPaperclip3 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPaperclip3'
import { IconPause } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPause'
import { IconPencil2 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPencil2'
import { IconPin } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPin'
import { IconPlay } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPlay'
import { IconPlayground } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPlayground'
import { IconPlugins } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPlugins'
import { IconPlusLarge } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPlusLarge'
import { IconPlusSmall } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPlusSmall'
import { IconProcessor } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconProcessor'
import { IconPullRequest } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconPullRequest'
import { IconRequestClosed } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconRequestClosed'
import { IconScriptAi } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconScriptAi'
import { IconSettingsGear1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSettingsGear1'
import { IconSettingsSliderHor } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSettingsSliderHor'
import { IconShieldBreak } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconShieldBreak'
import { IconShieldCheck } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconShieldCheck'
import { IconShieldKeyhole } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconShieldKeyhole'
import { IconSidebarSimpleLeftWide } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSidebarSimpleLeftWide'
import { IconSparklesThree } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSparklesThree'
import { IconSpeedHigh } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSpeedHigh'
import { IconSpeedLow } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSpeedLow'
import { IconSpeedMiddle } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSpeedMiddle'
import { IconSquareArrowTopRight } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSquareArrowTopRight'
import { IconSquareBehindSquare1 } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconSquareBehindSquare1'
import { IconStop } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconStop'
import { IconStrikeThrough } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconStrikeThrough'
import { IconTextSize } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconTextSize'
import { IconTrashCanSimple } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconTrashCanSimple'
import { IconUserAdd } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconUserAdd'
import { IconVolumeFull } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconVolumeFull'
import { IconVolumeOff } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconVolumeOff'
import { IconZoomIn } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconZoomIn'
import { IconZoomOut } from '@central-icons-react/round-outlined-radius-3-stroke-2/IconZoomOut'
import { useId, type ComponentProps, type ComponentType } from 'react'
import { centralSvgs } from 'virtual:central-svgs'

export type IconProps = Omit<
  ComponentProps<typeof IconArchive>,
  'mode' | 'maskId' | 'strokeWidth' | 'viewBox'
> & { filled?: boolean }
export type Icon = ComponentType<IconProps>

function centralIcon(Outlined: typeof IconArchive, Filled?: typeof IconArchive): Icon {
  return function CentralIcon({ filled = false, ...props }: IconProps) {
    const Glyph = filled && Filled ? Filled : Outlined
    return <Glyph size={16} aria-hidden='true' {...props} mode='raw' data-icon-pack='central' />
  }
}

export const AddImageIcon = centralIcon(IconAddImage)
export const AiBotHeadIcon = centralIcon(IconAiBotHead)
export const AnalyticsIcon = centralIcon(IconAnalytics)
export const ArchiveIcon = centralIcon(IconArchive)
export const ArrowDownIcon = centralIcon(IconArrowDown)
export const ArrowOutOfBoxIcon = centralIcon(IconArrowOutOfBox)
export const ArrowRotateClockwiseIcon = centralIcon(IconArrowRotateClockwise)
export const ArrowRotateCounterClockwiseIcon = centralIcon(IconArrowRotateCounterClockwise)
export const ArrowShareLeftIcon = centralIcon(IconArrowShareLeft)
export const ArrowUpIcon = centralIcon(IconArrowUp)
export const ArrowUpLeftIcon = centralIcon(IconArrowUpLeft)
export const ArrowUpRightIcon = centralIcon(IconArrowUpRight)
export const ArrowsLeftRightIcon = centralIcon(IconArrowsLeftRight)
export const AtomIcon = centralIcon(IconAtom)
export const Bell2Icon = centralIcon(IconBell2)
export const BoldIcon = centralIcon(IconBold)
export const BranchSimpleIcon = centralIcon(IconBranchSimple)
export const BrokenChainLink1Icon = centralIcon(IconBrokenChainLink1)
export const BubbleDotsIcon = centralIcon(IconBubbleDots)
export const BubblesIcon = centralIcon(IconBubbles)
export const CalendarClockIcon = centralIcon(IconCalendarClock)
export const ChainLink4Icon = centralIcon(IconChainLink4)
export const ChangesIcon = centralIcon(IconChanges)
export const ChecklistIcon = centralIcon(IconChecklist)
export const Checkmark1SmallIcon = centralIcon(IconCheckmark1Small)
export const ChevronDownSmallIcon = centralIcon(IconChevronDownSmall)
export const ChevronLeftSmallIcon = centralIcon(IconChevronLeftSmall)
export const ChevronRightSmallIcon = centralIcon(IconChevronRightSmall)
export const ChevronTopSmallIcon = centralIcon(IconChevronTopSmall)
export const CircleCheckIcon = centralIcon(IconCircleCheck)
export const CircleInfoIcon = centralIcon(IconCircleInfo)
export const CirclePlaceholderOffIcon = centralIcon(IconCirclePlaceholderOff)
export const CirclePlaceholderOnIcon = centralIcon(IconCirclePlaceholderOn)
export const CircleXIcon = centralIcon(IconCircleX)
export const CloseQuote1Icon = centralIcon(IconCloseQuote1)
export const CodeIcon = centralIcon(IconCode)
export const CommitsIcon = centralIcon(IconCommits)
export const ConciseIcon = centralIcon(IconConcise)
export const CropIcon = centralIcon(IconCrop)
export const CrossSmallIcon = centralIcon(IconCrossSmall)
export const DividerIcon = centralIcon(IconDivider)
export const DotGrid1x3VerticalIcon = centralIcon(IconDotGrid1x3Vertical)
export const DotGrid2x3Icon = centralIcon(IconDotGrid2x3)
export const DraftIcon = centralIcon(IconDraft)
export const EditSmall1Icon = centralIcon(IconEditSmall1)
export const ExclamationCircleIcon = centralIcon(IconExclamationCircle)
export const Expand45Icon = centralIcon(IconExpand45)
export const FileBendIcon = centralIcon(IconFileBend)
export const FileJpgIcon = centralIcon(IconFileJpg)
export const FilePdfIcon = centralIcon(IconFilePdf)
export const FilePngIcon = centralIcon(IconFilePng)
export const FileZipIcon = centralIcon(IconFileZip)
export const FilesIcon = centralIcon(IconFiles)
export const Filter2Icon = centralIcon(IconFilter2)
export const Folder1Icon = centralIcon(IconFolder1)
export const FolderAddLeftIcon = centralIcon(IconFolderAddLeft)
export const FolderOpenIcon = centralIcon(IconFolderOpen)
export const FoldersIcon = centralIcon(IconFolders)
export const H1Icon = centralIcon(IconH1)
export const H2Icon = centralIcon(IconH2)
export const H3Icon = centralIcon(IconH3)
export const Images1Icon = centralIcon(IconImages1)
export const ImportIcon = centralIcon(IconImport)
export const ItalicIcon = centralIcon(IconItalic)
export const KeyboardIcon = centralIcon(IconKeyboard)
export const LightningBoltIcon = centralIcon(IconLightningBolt, IconLightningBoltFilled)
export const LinebreakIcon = centralIcon(IconLinebreak)
export const ListBulletsIcon = centralIcon(IconListBullets)
export const MacbookIcon = centralIcon(IconMacbook)
export const MagicBookIcon = centralIcon(IconMagicBook)
export const MagnifyingGlass2Icon = centralIcon(IconMagnifyingGlass2)
export const MergedIcon = centralIcon(IconMerged)
export const Minimize45Icon = centralIcon(IconMinimize45)
export const NewspaperIcon = centralIcon(IconNewspaper)
export const NumberedListIcon = centralIcon(IconNumberedList)
export const PaintBrushIcon = centralIcon(IconPaintBrush)
export const Paperclip3Icon = centralIcon(IconPaperclip3)
export const PauseIcon = centralIcon(IconPause, IconPauseFilled)
export const Pencil2Icon = centralIcon(IconPencil2)
export const PinIcon = centralIcon(IconPin, IconPinFilled)
export const PlayIcon = centralIcon(IconPlay, IconPlayFilled)
export const PlaygroundIcon = centralIcon(IconPlayground)
export const PluginsIcon = centralIcon(IconPlugins)
export const PlusLargeIcon = centralIcon(IconPlusLarge)
export const PlusSmallIcon = centralIcon(IconPlusSmall)
export const ProcessorIcon = centralIcon(IconProcessor)
export const PullRequestIcon = centralIcon(IconPullRequest)
export const RequestClosedIcon = centralIcon(IconRequestClosed)
export const ScriptAiIcon = centralIcon(IconScriptAi)
export const SettingsGear1Icon = centralIcon(IconSettingsGear1)
export const SettingsSliderHorIcon = centralIcon(IconSettingsSliderHor)
export const ShieldBreakIcon = centralIcon(IconShieldBreak)
export const ShieldCheckIcon = centralIcon(IconShieldCheck)
export const ShieldKeyholeIcon = centralIcon(IconShieldKeyhole)
export const SidebarSimpleLeftWideIcon = centralIcon(
  IconSidebarSimpleLeftWide,
  IconSidebarSimpleLeftWideFilled
)
export const SparklesThreeIcon = centralIcon(IconSparklesThree)
export const SpeedHighIcon = centralIcon(IconSpeedHigh)
export const SpeedLowIcon = centralIcon(IconSpeedLow)
export const SpeedMiddleIcon = centralIcon(IconSpeedMiddle)
export const SquareArrowTopRightIcon = centralIcon(IconSquareArrowTopRight)
export const SquareBehindSquare1Icon = centralIcon(IconSquareBehindSquare1)
export const StopIcon = centralIcon(IconStop, IconStopFilled)
export const StrikeThroughIcon = centralIcon(IconStrikeThrough)
export const TextSizeIcon = centralIcon(IconTextSize)
export const TrashCanSimpleIcon = centralIcon(IconTrashCanSimple)
export const UserAddIcon = centralIcon(IconUserAdd)
export const VolumeFullIcon = centralIcon(IconVolumeFull)
export const VolumeOffIcon = centralIcon(IconVolumeOff)
export const ZoomInIcon = centralIcon(IconZoomIn)
export const ZoomOutIcon = centralIcon(IconZoomOut)

// Parent slot rules must not resize the SVGs inside composed icons.
const nestedSize = { width: 24, height: 24 }

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const fileGlyphs: Record<string, typeof IconArchive> = {
  'application/pdf': IconFilePdf,
  'application/x-zip-compressed': IconFileZip,
  'application/zip': IconFileZip,
  'image/jpeg': IconFileJpg,
  'image/png': IconFilePng,
}

// Central has no text or Markdown file, so those take the PDF's page, clipped above its letters, and ours.
const fileLetters = {
  md: [
    'M6.5 20V15L8.75 18L11 15V20',
    'M13.5 15V20H15C16.3807 20 17.5 18.8807 17.5 17.5C17.5 16.1193 16.3807 15 15 15H13.5Z',
  ],
  txt: ['M4 15H7.5M5.75 15V20', 'M10 15L14 20M14 15L10 20', 'M16.5 15H20M18.25 15V20'],
}

function lettersFor(type: string, extension: string | undefined) {
  if (type === 'text/markdown' || type === 'text/x-markdown' || extension === 'md')
    return fileLetters.md
  if (type === 'text/plain' || extension === 'txt' || extension === 'log') return fileLetters.txt
  return undefined
}

type FileTypeIconProps = Omit<IconProps, 'filled'> & { mimeType: string; name?: string }

export function FileTypeIcon({ mimeType, name, size = 16, ...props }: FileTypeIconProps) {
  const clipId = useId()
  const type = mimeType.split(';')[0]!.trim().toLowerCase()
  const letters = lettersFor(type, name?.split('.').at(-1)?.toLowerCase())
  const Glyph = fileGlyphs[type] ?? IconFileBend
  return (
    <svg
      viewBox='0 0 24 24'
      width={size}
      height={size}
      fill='none'
      aria-hidden='true'
      {...props}
      data-icon-pack='central'
    >
      {letters ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect width='24' height='13' />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <IconFilePdf size={24} mode='raw' aria-hidden='true' style={nestedSize} />
          </g>
          <g {...stroke}>
            {letters.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </>
      ) : (
        <Glyph size={24} mode='raw' aria-hidden='true' style={nestedSize} />
      )}
    </svg>
  )
}

type EffortIconProps = Omit<IconProps, 'filled'> & { level: EffortLevel }

export function EffortIcon({ level, size = 16, ...props }: EffortIconProps) {
  const clipId = useId()
  const composed = level === 'high' || level === 'xhigh'
  const Glyph = level === 'low' ? IconSpeedLow : level === 'max' ? IconSpeedHigh : IconSpeedMiddle
  return (
    <svg
      viewBox='0 0 24 24'
      width={size}
      height={size}
      fill='none'
      aria-hidden='true'
      {...props}
      data-icon-pack='central'
    >
      {composed ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx='12' cy='13' r='6.5' />
            </clipPath>
          </defs>
          <g {...stroke}>
            <path opacity='0.12' d='M6 18.7083A9 9 0 1 1 18 18.7083' />
            <path
              d={
                level === 'high'
                  ? 'M6 18.7083A9 9 0 0 1 17.646 4.991'
                  : 'M6 18.7083A9 9 0 1 1 20.951 11.059'
              }
            />
          </g>
          <g transform={`rotate(${level === 'high' ? 45.17 : 90.33} 12 13)`}>
            <g clipPath={`url(#${clipId})`}>
              <IconSpeedMiddle size={24} mode='raw' aria-hidden='true' style={nestedSize} />
            </g>
          </g>
        </>
      ) : (
        <Glyph size={24} mode='raw' aria-hidden='true' style={nestedSize} />
      )}
    </svg>
  )
}

export function WorktreeIcon({ size = 16, ...props }: Omit<IconProps, 'filled'>) {
  const maskId = useId()
  return (
    <svg
      viewBox='0 0 24 24'
      width={size}
      height={size}
      fill='none'
      aria-hidden='true'
      {...props}
      data-icon-pack='central'
    >
      <defs>
        <mask id={maskId} maskUnits='userSpaceOnUse' x='0' y='0' width='24' height='24'>
          <rect width='24' height='24' fill='white' />
          <rect x='9' y='13' width='15' height='11' fill='black' />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <IconFolder1 size={24} mode='raw' aria-hidden='true' style={nestedSize} />
      </g>
      <g {...stroke}>
        <path d='M9 19h0M21 13h0' />
        <path d='M13 15V21' />
        <path d='M17 19C14.7909 19 13 17.2091 13 15' />
        <circle cx='13' cy='13' r='2' />
        <circle cx='19' cy='19' r='2' />
      </g>
    </svg>
  )
}

// A glyph as an SVG data URL for CSS masks, where a component can't render (inside Pierre's shadow
// roots), with its line at 2px for `size` as index.css draws the components.
function centralMask(svg: string, size: number) {
  const sized = svg
    .replace('width="24px" height="24px"', `width="${size}" height="${size}"`)
    .replace(
      /stroke-width="([\d.]+)"/g,
      (_, width: string) => `stroke-width="${(Number(width) * 24) / size}"`
    )
    .replaceAll('currentColor', 'black')
  return `url("data:image/svg+xml,${encodeURIComponent(sized)}")`
}

export const centralMasks = {
  arrowDown: centralMask(centralSvgs.ArrowDown, 12),
  arrowTopBottom: centralMask(centralSvgs.ArrowTopBottom, 12),
  arrowUp: centralMask(centralSvgs.ArrowUp, 12),
  bubbleDots: centralMask(centralSvgs.BubbleDots, 12),
  magnifyingGlass2: centralMask(centralSvgs.MagnifyingGlass2, 12),
}

// A glyph as a sprite-sheet symbol, its line 2px at any size.
function centralSymbol(svg: string, id: string) {
  const shapes = svg
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/<(path|circle|rect|line) /g, '<$1 vector-effect="non-scaling-stroke" ')
  return `<symbol id="${id}" viewBox="0 0 24 24">${shapes}</symbol>`
}

export const centralSymbols = {
  caretDown: centralSymbol(centralSvgs.ChevronDownSmall, 'jetty-caret-down'),
}
