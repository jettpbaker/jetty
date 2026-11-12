import type { Attachment } from '@jetty/shared/items'
import type { Bot } from '@jetty/shared/wire'

import {
  instructionsPath,
  subagentTabId,
  useDetailsRequest,
  useFileDirty,
  useProject,
  useSubagents,
  useSubagentTabs,
} from '@/state'
import { soleProjectId } from '@jetty/shared/bots'
import { Activity, useCallback, useLayoutEffect, useState, type ReactNode } from 'react'

import { OpenAttachment } from './attachment_files'
import { BotOverview } from './bot_overview'
import {
  DetailsChatPanel,
  DetailsLayout,
  DetailsPane,
  DetailsTabPanel,
  useDetailsLayout,
} from './details_layout'
import { SubagentView } from './subagent_view'
import { BotDetailsTabs } from './thread_details_tabs'
import { InstructionsFile, ThreadFile } from './thread_file'

const noCheckout = {}

// A bot's chat with its details pane: Overview, its subagents, an attached file opened from the
// chat, and the chat as a tab while the pane is full width.
export function BotDetailsLayout({ bot, children }: { bot: Bot; children: ReactNode }) {
  const [pickedTab, setTab] = useState('overview')
  // Opening shows Overview, even where the chat would be a tab of its own, unless a file opened it.
  const layout = useDetailsLayout(useCallback(() => setTab('overview'), []))
  const { open, ready, full, narrow, expanded, setExpanded, setChatSlot, show } = layout
  const [file, setFile] = useState<Attachment | 'instructions'>()
  // The route component is reused when the open bot changes, so a file opened on the last bot
  // would otherwise stay open against this one.
  const [shownBotId, setShownBotId] = useState(bot.id)
  if (bot.id !== shownBotId) {
    setShownBotId(bot.id)
    setFile(undefined)
    setTab('overview')
  }
  const instructionsDirty = useFileDirty(bot.id, instructionsPath)
  const project = useProject(soleProjectId(bot))
  const allSubagents = useSubagents(bot.id)
  const { visible: openedSubagents, hide: hideSubagent } = useSubagentTabs(bot.id)
  const subagents = openedSubagents.flatMap((id) => allSubagents.filter((agent) => agent.id === id))
  const shows = (id: string | undefined) =>
    subagents.some((agent) => subagentTabId(agent.id) === id)
  const tab = full || (pickedTab === 'file' && file) || shows(pickedTab) ? pickedTab : 'overview'
  const { tab: requestedTab, consume } = useDetailsRequest(bot.id)
  const requestShown = shows(requestedTab)
  useLayoutEffect(() => {
    if (!requestedTab || !requestShown) return
    consume()
    setTab(requestedTab)
    if (!open) show()
  }, [requestedTab, requestShown, consume, open, show])
  const openAttachment = useCallback(
    (attachment: Attachment) => {
      setFile(attachment)
      setTab('file')
      if (!open) show()
      return true
    },
    [open, show]
  )
  const openInstructions = useCallback(() => {
    setFile('instructions')
    setTab('file')
  }, [])
  return (
    <OpenAttachment value={openAttachment}>
      <DetailsLayout
        layout={layout}
        label='Bot details'
        pane={
          <DetailsPane
            label='Bot details'
            tab={tab}
            onTabChange={setTab}
            full={full}
            narrow={narrow}
            expanded={expanded}
            onExpandedChange={setExpanded}
            tabs={
              <BotDetailsTabs
                chat={full}
                subagents={subagents}
                onCloseSubagent={(id) => {
                  hideSubagent(id)
                  if (tab === subagentTabId(id)) setTab('overview')
                }}
                file={
                  file && {
                    name: file === 'instructions' ? instructionsPath : file.name,
                    dirty: file === 'instructions' && instructionsDirty,
                    onClose: () => {
                      setFile(undefined)
                      setTab('overview')
                    },
                  }
                }
              />
            }
          >
            <DetailsChatPanel tab={tab} slotRef={setChatSlot} />
            <DetailsTabPanel value='overview' tab={tab}>
              {open && <BotOverview bot={bot} onOpenInstructions={openInstructions} />}
            </DetailsTabPanel>
            {subagents.map((agent) => {
              const id = subagentTabId(agent.id)
              return (
                <DetailsTabPanel key={id} value={id} tab={tab}>
                  {open && ready && (
                    <Activity mode={tab === id ? 'visible' : 'hidden'}>
                      <SubagentView
                        threadId={bot.id}
                        agentId={agent.id}
                        projectPath={project?.path}
                      />
                    </Activity>
                  )}
                </DetailsTabPanel>
              )
            })}
            {file && (
              <DetailsTabPanel value='file' tab={tab}>
                {open && file === 'instructions' && <InstructionsFile botId={bot.id} focus={0} />}
                {open && file !== 'instructions' && (
                  <ThreadFile
                    key={file.id}
                    threadId={bot.id}
                    target={{ path: file.name, attachment: file }}
                    checkout={noCheckout}
                    focus={0}
                  />
                )}
              </DetailsTabPanel>
            )}
          </DetailsPane>
        }
      >
        {children}
      </DetailsLayout>
    </OpenAttachment>
  )
}
