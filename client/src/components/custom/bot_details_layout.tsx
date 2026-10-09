import type { Attachment } from '@jetty/shared/items'
import type { Bot } from '@jetty/shared/wire'

import { useCallback, useState, type ReactNode } from 'react'

import { OpenAttachment } from './attachment_files'
import { BotOverview } from './bot_overview'
import {
  DetailsChatPanel,
  DetailsLayout,
  DetailsPane,
  DetailsTabPanel,
  useDetailsLayout,
} from './details_layout'
import { BotDetailsTabs } from './thread_details_tabs'
import { ThreadFile } from './thread_file'

const noCheckout = {}

// A bot's chat with its details pane: Overview, an attached file opened from the chat, and the
// chat as a tab while the pane is full width.
export function BotDetailsLayout({ bot, children }: { bot: Bot; children: ReactNode }) {
  const layout = useDetailsLayout()
  const { open, full, narrow, expanded, setExpanded, setChatSlot, show } = layout
  const [pickedTab, setTab] = useState('overview')
  const [file, setFile] = useState<Attachment>()
  // Opening shows Overview, even where the chat would be a tab of its own, unless a file opened it.
  const [openingTab, setOpeningTab] = useState<string>()
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTab(openingTab ?? 'overview')
    setOpeningTab(undefined)
  }
  const tab = full || (pickedTab === 'file' && file) ? pickedTab : 'overview'
  const openAttachment = useCallback(
    (attachment: Attachment) => {
      setFile(attachment)
      setTab('file')
      if (!open) {
        setOpeningTab('file')
        show()
      }
      return true
    },
    [open, show]
  )
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
                file={
                  file && {
                    name: file.name,
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
              {open && <BotOverview bot={bot} />}
            </DetailsTabPanel>
            {file && (
              <DetailsTabPanel value='file' tab={tab}>
                {open && (
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
