import type {
  AgentBehaviourKey,
  JobModel,
  JobName,
  ProviderId,
  ProviderModel,
} from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { describeLoadout, findModel, type Loadout } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useChrome } from '@/state'
import { useModelRefresh, useSetAgentBehaviour, useSetJobModel } from '@/state/models'
import {
  agentBehaviours,
  claudeJobModel,
  GUIDE_MIN_CHANGED_LINES,
  resolveTitleEffort,
  resolveTitleModel,
} from '@jetty/shared/wire'
import { useState } from 'react'

import { loadoutParts, ModelMenuItems } from './composer_loadout'
import { DisabledTooltip } from './disabled_tooltip'
import {
  Archive02Icon,
  ArrowDown01Icon,
  ArrowShrink02Icon,
  BookOpenIcon,
  Clock01Icon,
  NewspaperIcon,
  TextFontIcon,
} from './huge_icons'
import { GitPullRequestIcon } from './lucide_icons'
import { ModelLabel } from './model_label'
import { ProviderGlyph } from './provider_glyph'
import {
  ComingSoon,
  SettingsCard,
  SettingsLinkRow,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  comingSoon,
  selectTriggerClass,
} from './settings_layout'

function useAgentBehaviours() {
  const chrome = useChrome()
  const save = useSetAgentBehaviour()
  const [pending, setPending] = useState<Partial<Record<AgentBehaviourKey, boolean>>>({})
  function enabled(key: AgentBehaviourKey) {
    const behaviour = agentBehaviours.find((each) => each.key === key)
    return pending[key] ?? chrome?.agentBehaviours?.[key] ?? behaviour?.defaultEnabled ?? false
  }
  function set(key: AgentBehaviourKey, value: boolean) {
    setPending((current) => ({ ...current, [key]: value }))
    save(key, value, () =>
      setPending((current) => {
        if (current[key] !== value) return current
        const rest = { ...current }
        delete rest[key]
        return rest
      })
    )
  }
  return { enabled, set }
}

// A job's saved choice as the loadout the composer's menu edits: titles fall back to the cheapest
// model you have, at its lowest effort; guides and tidy passes to their Claude default.
function jobLoadout(
  job: JobName,
  choice: JobModel | undefined,
  catalog: readonly ProviderModel[]
): Loadout | undefined {
  if (job !== 'title') {
    const { model, effort } = claudeJobModel(job, choice)
    return { provider: model.provider, model: model.id, ...(effort ? { effort } : {}), fast: false }
  }
  const model = resolveTitleModel(choice?.model, catalog)
  if (!model) return undefined
  const effort = resolveTitleEffort(model, choice?.effort)
  return {
    provider: model.provider,
    model: model.id,
    ...(effort ? { effort } : {}),
    fast: model.fast && choice?.fast === true,
  }
}

function useJobModel(job: JobName) {
  const chrome = useChrome()
  const save = useSetJobModel()
  const [pending, setPending] = useState<JobModel>()
  const catalog = chrome?.models ?? []
  const value = jobLoadout(job, pending ?? chrome?.jobModels?.[job], catalog)
  function set({ provider, model, effort, fast }: Loadout) {
    // Titles keep their effort across a model switch where they can, and otherwise take the lowest.
    const switched =
      job === 'title' && value && (value.provider !== provider || value.model !== model)
    const picked = switched ? findModel(catalog, { provider, model }) : undefined
    const kept = picked ? resolveTitleEffort(picked, value?.effort) : effort
    const next: JobModel = {
      model: { provider, id: model },
      ...(kept ? { effort: kept } : {}),
      fast,
    }
    setPending(next)
    save(job, next, () => setPending((current) => (current === next ? undefined : current)))
  }
  return { catalog, value, set, ready: !!chrome }
}

// The composer's model menu without its loadout, on a settings select trigger.
function JobModelSelect({
  label,
  catalog,
  value,
  lockedProvider,
  disabled,
  onChange,
}: {
  label: string
  catalog: readonly ProviderModel[]
  value: Loadout | undefined
  lockedProvider?: ProviderId
  disabled?: boolean
  onChange: (loadout: Loadout) => void
}) {
  const { refresh } = useModelRefresh()
  const models = lockedProvider
    ? catalog.filter((model) => model.provider === lockedProvider)
    : catalog
  const { model, name } = loadoutParts(catalog, value)
  const details = value && describeLoadout(value)
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        aria-label={`${label}: ${[name, details].filter(Boolean).join(', ') || 'none'}`}
        disabled={disabled}
        render={<Button variant='ghost' className={cn(selectTriggerClass, 'group/chip')} />}
      >
        {value ? (
          <>
            <ProviderGlyph provider={value.provider} className='size-3' />
            {model ? <ModelLabel model={model} /> : name}
            {details && (
              <span className='text-muted-foreground group-hover/chip:text-foreground group-disabled/chip:text-current group-aria-expanded/chip:text-foreground'>
                {details}
              </span>
            )}
          </>
        ) : (
          'Choose a model'
        )}
        <ArrowDown01Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-max min-w-56'>
        <ModelMenuItems catalog={catalog} models={models} value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SettingsIntelligence() {
  const { enabled, set } = useAgentBehaviours()
  const titles = useJobModel('title')
  const tidying = useJobModel('tidy')
  return (
    <SettingsPage
      title='Intelligence'
      description='The jobs Jetty hands to a model on its own, and what agents may do without being asked.'
    >
      <SettingsSection
        title='Built in'
        description='Small jobs Jetty runs itself, on your own subscriptions.'
      >
        <SettingsCard>
          <SettingsRow
            id='thread-titles'
            icon={TextFontIcon}
            title='Thread titles'
            description='Names new threads, and the branches they work on'
          >
            <span className={cn('flex shrink-0', !titles.ready && 'invisible')}>
              <JobModelSelect
                label='Title model'
                catalog={titles.catalog}
                value={titles.value}
                onChange={titles.set}
              />
            </span>
          </SettingsRow>
          <SettingsLinkRow
            id='guided-reviews'
            page='guided-reviews'
            icon={BookOpenIcon}
            title='Guided reviews'
            description='Walks you through a pull request in chapters, from its Guide tab'
          />
          <SettingsRow
            id='tidying'
            icon={ArrowShrink02Icon}
            title='Bot tidying'
            description='Bots compact their chats and file their notes'
          >
            <span className={cn('flex shrink-0', !tidying.ready && 'invisible')}>
              <JobModelSelect
                label='Tidy model'
                catalog={tidying.catalog}
                value={tidying.value}
                lockedProvider='claude'
                onChange={tidying.set}
              />
            </span>
          </SettingsRow>
          <SettingsRow
            id='digest'
            icon={NewspaperIcon}
            title='Digest'
            description='Catches you up on every thread when you come back'
            disabled
          >
            <ComingSoon />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title='On their own'
        description='What agents and bots may do without being asked.'
      >
        <SettingsCard>
          <SettingsLinkRow
            id='pr-activity'
            page='pr-activity'
            icon={<GitPullRequestIcon />}
            title='Wake on PR activity'
            description='Agents pick up reviews, failing checks and conflicts on PRs they opened'
          />
          <SettingsRow
            id='archive'
            icon={Archive02Icon}
            title='Archive finished threads'
            description='Agents and bots archive threads they started once the work is merged'
          >
            <Switch
              aria-label='Archive finished threads'
              checked={enabled('archiveCompletedThreads')}
              onCheckedChange={(value) => set('archiveCompletedThreads', value)}
            />
          </SettingsRow>
          <SettingsLinkRow
            id='check-ins'
            page='bots'
            hash='rhythm'
            icon={Clock01Icon}
            title='Bot check-ins'
            description="Quiet bots look over their area, only while you're around"
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

export function SettingsGuidedReviews() {
  const { enabled, set } = useAgentBehaviours()
  const guides = useJobModel('guide')
  const on = enabled('guidedReviews')
  const off = on ? undefined : 'Turn on Guided reviews first'
  return (
    <SettingsPage
      parent='intelligence'
      title='Guided reviews'
      description='A Guide tab on pull requests that walks you through the change in chapters, in the order it reads best.'
    >
      <SettingsCard className={guides.ready ? undefined : 'invisible'}>
        <SettingsRow title='Guided reviews' description='Show a Guide tab on pull requests'>
          <Switch
            aria-label='Guided reviews'
            checked={on}
            onCheckedChange={(value) => set('guidedReviews', value)}
          />
        </SettingsRow>
        <SettingsRow
          title='Model'
          description='Reads the diff and writes the chapters'
          disabled={!on}
        >
          <DisabledTooltip reason={off} wrap='flex shrink-0'>
            <JobModelSelect
              label='Guide model'
              catalog={guides.catalog}
              value={guides.value}
              lockedProvider='claude'
              disabled={!on}
              onChange={guides.set}
            />
          </DisabledTooltip>
        </SettingsRow>
      </SettingsCard>
      <SettingsSection title='When to write one'>
        <SettingsCard>
          <SettingsRow
            title='Skip small pull requests'
            description='Fewer changed lines than this, added plus deleted, get no guide'
            disabled
          >
            <DisabledTooltip reason={comingSoon} wrap='flex shrink-0 items-center gap-2'>
              <span className='flex items-center gap-2'>
                <input
                  disabled
                  value={GUIDE_MIN_CHANGED_LINES}
                  aria-label='Smallest pull request to guide, in changed lines'
                  readOnly
                  className='pointer-events-none h-7 w-14 rounded-sm border border-input bg-input/30 px-2 text-right font-mono text-13 text-muted-foreground'
                />
                <span className='text-13 text-muted-foreground'>lines</span>
              </span>
            </DisabledTooltip>
          </SettingsRow>
          <SettingsRow
            id='write-ahead'
            title='Write ahead for review requests'
            description="Start a guide when someone asks for your review, so it's ready when you open it"
            disabled={!on}
          >
            <DisabledTooltip reason={off} wrap='flex'>
              <Switch
                aria-label='Write ahead for review requests'
                disabled={!on}
                checked={enabled('prefetchPullRequestGuides')}
                onCheckedChange={(value) => set('prefetchPullRequestGuides', value)}
                className={cn(!on && 'pointer-events-none')}
              />
            </DisabledTooltip>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title='Guides'>
        <SettingsCard>
          <SettingsRow
            title='Instructions'
            description='Tell guides what to lead with, and what to skip'
            disabled
          >
            <ComingSoon />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

const watchKeys = ['watchReviews', 'watchChecks', 'watchConflicts', 'mergeWhenReady'] as const

const watchDescriptions: Record<(typeof watchKeys)[number], string> = {
  watchReviews: 'A review or a comment on the pull request',
  watchChecks: 'A check fails on the latest push',
  watchConflicts: 'The pull request can no longer merge cleanly',
  mergeWhenReady: 'When GitHub says it’s ready to merge, the agent merges it',
}

export function SettingsPullRequestActivity() {
  const { enabled, set } = useAgentBehaviours()
  const on = enabled('watchPullRequests')
  return (
    <SettingsPage
      parent='intelligence'
      title='Wake on PR activity'
      description='Agents keep an eye on the pull requests they open or push to, so you never have to tell them CI failed.'
    >
      <SettingsCard>
        <SettingsRow
          title='Wake on PR activity'
          description='Jetty passes what happened to the agent that opened the pull request'
        >
          <Switch
            aria-label='Wake on PR activity'
            checked={on}
            onCheckedChange={(value) => set('watchPullRequests', value)}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsSection title='Wake for'>
        <SettingsCard>
          {watchKeys.map((key) => {
            const behaviour = agentBehaviours.find((each) => each.key === key)!
            return (
              <SettingsRow
                key={key}
                title={behaviour.label}
                description={watchDescriptions[key]}
                disabled={!on}
              >
                <DisabledTooltip
                  reason={on ? undefined : 'Turn on Wake on PR activity first'}
                  wrap='flex'
                >
                  <Switch
                    aria-label={behaviour.label}
                    disabled={!on}
                    checked={enabled(key)}
                    onCheckedChange={(value) => set(key, value)}
                    className={cn(!on && 'pointer-events-none')}
                  />
                </DisabledTooltip>
              </SettingsRow>
            )
          })}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
