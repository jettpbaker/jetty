import type { EffortLevel } from '@jetty/shared/events'
import type { AgentBehaviourKey, TitleModel } from '@jetty/shared/wire'

import { Switch } from '@/components/ui/switch'
import { effortLabels, findModel, modelKey } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useChrome } from '@/state'
import { useSetAgentBehaviour, useSetTitleModel } from '@/state/models'
import { modelLabelText } from '@jetty/shared/model-name'
import {
  agentBehaviours,
  GUIDE_MIN_CHANGED_LINES,
  resolveTitleEffort,
  resolveTitleModel,
} from '@jetty/shared/wire'
import { useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import {
  Archive02Icon,
  ArrowShrink02Icon,
  BookOpenIcon,
  Clock01Icon,
  NewspaperIcon,
  TextFontIcon,
} from './huge_icons'
import { GitPullRequestIcon } from './lucide_icons'
import { ProviderGlyph } from './provider_glyph'
import {
  ComingSoon,
  DisabledSwitch,
  SettingsCard,
  SettingsLinkRow,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
  comingSoon,
} from './settings_layout'

// Guides are written by one model the server picks; settings show it until it can be changed.
const guideModel = { provider: 'claude', label: 'Sonnet 5.5', effort: 'medium' } as const

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

function useTitleModel() {
  const chrome = useChrome()
  const save = useSetTitleModel()
  const [pending, setPending] = useState<TitleModel>()
  const models = chrome?.models ?? []
  const choice = pending ?? chrome?.titleModel ?? { model: null }
  const chosen =
    choice.model && findModel(models, { provider: choice.model.provider, model: choice.model.id })
  const resolved = chosen || resolveTitleModel(null, models)
  const effort = resolved && resolveTitleEffort(resolved, choice.effort)
  function set(next: TitleModel) {
    setPending(next)
    save(next, () => setPending((current) => (current === next ? undefined : current)))
  }
  return { models, choice, chosen, resolved, effort, set, ready: !!chrome }
}

function ModelValue({ provider, label }: { provider?: string; label: string }) {
  return (
    <>
      {provider && <ProviderGlyph provider={provider} className='size-3' />}
      {label}
    </>
  )
}

export function SettingsIntelligence() {
  const { enabled, set } = useAgentBehaviours()
  const titles = useTitleModel()
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
          <SettingsLinkRow
            id='thread-titles'
            page='thread-titles'
            icon={TextFontIcon}
            title='Thread titles'
            description='Names new threads, and the branches they work on'
            value={
              <ModelValue
                provider={titles.resolved?.provider}
                label={
                  titles.resolved
                    ? [
                        modelLabelText(titles.resolved),
                        titles.effort && effortLabels[titles.effort],
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Automatic'
                }
              />
            }
          />
          <SettingsLinkRow
            id='guided-reviews'
            page='guided-reviews'
            icon={BookOpenIcon}
            title='Guided reviews'
            description='Walks you through a pull request in chapters, from its Guide tab'
            value={
              <ModelValue
                provider={guideModel.provider}
                label={`${guideModel.label} · ${effortLabels[guideModel.effort]}`}
              />
            }
          />
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
            value={enabled('watchPullRequests') ? 'On' : 'Off'}
          />
          <SettingsRow
            id='archive'
            icon={Archive02Icon}
            title='Archive finished threads'
            description='Agents archive threads they started once the work is merged'
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
            value='Hourly'
          />
          <SettingsLinkRow
            id='tidying'
            page='bots'
            hash='rhythm'
            icon={ArrowShrink02Icon}
            title='Bot tidying'
            description='Bots compact their chats and file their notes'
            value="While you're away"
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

const automatic = 'automatic'

export function SettingsThreadTitles() {
  const { models, choice, chosen, resolved, effort, set, ready } = useTitleModel()
  const automaticModel = resolveTitleModel(null, models)
  const efforts = resolved?.efforts ?? []
  return (
    <SettingsPage
      parent='intelligence'
      title='Thread titles'
      description='A short title for each new thread, and the branch name a worktree takes from it.'
    >
      <SettingsCard className={ready ? undefined : 'invisible'}>
        <SettingsRow
          title='Model'
          description={
            automaticModel
              ? `Automatic picks ${modelLabelText(automaticModel)}, or the cheapest you have`
              : 'Automatic picks the cheapest model you have'
          }
        >
          <SettingsSelect
            label='Title model'
            value={chosen ? modelKey(chosen) : automatic}
            onChange={(key) => {
              const model = models.find((candidate) => modelKey(candidate) === key)
              set({ ...choice, model: model ? { provider: model.provider, id: model.id } : null })
            }}
            options={[
              { value: automatic, label: 'Automatic' },
              ...models.map((model) => ({
                value: modelKey(model),
                label: modelLabelText(model),
                icon: <ProviderGlyph provider={model.provider} className='size-3' />,
              })),
            ]}
          />
        </SettingsRow>
        <SettingsRow title='Effort' description='Titles are short; low effort is plenty'>
          {efforts.length > 0 && effort ? (
            <SettingsSegmented
              label='Title effort'
              value={effort}
              onChange={(next: EffortLevel) => set({ ...choice, effort: next })}
              options={efforts.map((level) => ({ value: level, label: effortLabels[level] }))}
            />
          ) : (
            <span className='shrink-0 pr-1 text-13 text-muted-foreground'>None</span>
          )}
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  )
}

export function SettingsGuidedReviews() {
  const { enabled, set } = useAgentBehaviours()
  return (
    <SettingsPage
      parent='intelligence'
      title='Guided reviews'
      description='A Guide tab on pull requests that walks you through the change in chapters, in the order it reads best.'
    >
      <SettingsCard>
        <SettingsRow
          title='Guided reviews'
          description='Show a Guide tab on pull requests'
          disabled
        >
          <DisabledSwitch checked label='Guided reviews' />
        </SettingsRow>
        <SettingsRow title='Model' description='Reads the diff and writes the chapters' disabled>
          <SettingsSelect
            label='Guide model'
            value='sonnet'
            options={[
              {
                value: 'sonnet',
                label: guideModel.label,
                icon: <ProviderGlyph provider={guideModel.provider} className='size-3' />,
              },
            ]}
            disabled
          />
        </SettingsRow>
        <SettingsRow
          title='Effort'
          description='More effort reads further around each change, and takes longer'
          disabled
        >
          <SettingsSegmented
            label='Guide effort'
            value={guideModel.effort}
            options={(['low', 'medium', 'high'] as const).map((level) => ({
              value: level,
              label: effortLabels[level],
            }))}
            disabled
          />
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
          >
            <Switch
              aria-label='Write ahead for review requests'
              checked={enabled('prefetchPullRequestGuides')}
              onCheckedChange={(value) => set('prefetchPullRequestGuides', value)}
            />
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
