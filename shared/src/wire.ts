import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

import { SequencedEvent, SessionStatus } from './events'
import { ApprovalDecision } from './items'
import { ThreadState } from './reducer'

export const newId = (): string => uuidv7()

export const MAX_IMAGES_PER_TURN = 8
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export const PermissionMode = z.enum([
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'dontAsk',
  'bypassPermissions',
])
export type PermissionMode = z.infer<typeof PermissionMode>

export const Project = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  createdAt: z.number().int(),
})
export type Project = z.infer<typeof Project>

export const ThreadGitStatus = z.object({
  branch: z.string(),
  dirty: z.boolean(),
  pr: z
    .object({
      number: z.number().int().positive(),
      state: z.enum(['draft', 'open', 'merged', 'closed']),
      url: z.string(),
    })
    .nullable(),
})
export type ThreadGitStatus = z.infer<typeof ThreadGitStatus>

export const ThreadMeta = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: SessionStatus,
  archived: z.boolean(),
  updatedAt: z.number().int(),
  git: ThreadGitStatus.optional(),
})
export type ThreadMeta = z.infer<typeof ThreadMeta>

export const UploadAttachment = z.object({
  name: z.string(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  dataUrl: z.string(),
})
export type UploadAttachment = z.infer<typeof UploadAttachment>

export const methods = {
  'chrome.subscribe': {
    params: z.object({}),
    result: z.null(),
  },
  'project.create': {
    params: z.object({ path: z.string(), title: z.string().optional() }),
    result: z.object({ project: Project }),
  },
  'thread.create': {
    params: z.object({ projectId: z.string() }),
    result: z.object({ thread: ThreadMeta }),
  },
  'thread.archive': {
    params: z.object({ threadId: z.string() }),
    result: z.null(),
  },
  'thread.subscribe': {
    params: z.object({
      threadId: z.string(),
      afterSeq: z.number().int().nonnegative().optional(),
    }),
    result: z.object({
      snapshot: ThreadState.optional(),
      seq: z.number().int().nonnegative(),
    }),
  },
  'thread.unsubscribe': {
    params: z.object({ threadId: z.string() }),
    result: z.null(),
  },
  'turn.start': {
    params: z.object({
      threadId: z.string(),
      text: z.string(),
      attachments: z.array(UploadAttachment).max(MAX_IMAGES_PER_TURN).optional(),
      model: z.string().optional(),
      permissionMode: PermissionMode.optional(),
    }),
    result: z.object({ turnId: z.string() }),
  },
  'turn.interrupt': {
    params: z.object({ threadId: z.string() }),
    result: z.null(),
  },
  'approval.respond': {
    params: z.object({
      threadId: z.string(),
      itemId: z.string(),
      decision: ApprovalDecision,
      updatedPermissions: z.array(z.unknown()).optional(),
    }),
    result: z.null(),
  },
} as const

export type MethodName = keyof typeof methods
export type ParamsOf<M extends MethodName> = z.infer<(typeof methods)[M]['params']>
export type ResultOf<M extends MethodName> = z.infer<(typeof methods)[M]['result']>

const methodNames = Object.keys(methods) as [MethodName, ...MethodName[]]

export const RequestMessage = z.object({
  id: z.string(),
  method: z.enum(methodNames),
  params: z.unknown(),
})
export type RequestMessage = z.infer<typeof RequestMessage>

export const WireError = z.object({ code: z.string(), message: z.string() })
export type WireError = z.infer<typeof WireError>

export const ResponseMessage = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: WireError.optional(),
})
export type ResponseMessage = z.infer<typeof ResponseMessage>

export const ChromePushData = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    projects: z.array(Project),
    threads: z.array(ThreadMeta),
  }),
  z.object({ type: z.literal('project.upserted'), project: Project }),
  z.object({ type: z.literal('thread.upserted'), thread: ThreadMeta }),
  z.object({ type: z.literal('thread.removed'), threadId: z.string() }),
])
export type ChromePushData = z.infer<typeof ChromePushData>

export const PushMessage = z.discriminatedUnion('sub', [
  z.object({ sub: z.literal('chrome'), data: ChromePushData }),
  SequencedEvent.extend({ sub: z.literal('thread'), threadId: z.string() }),
])
export type PushMessage = z.infer<typeof PushMessage>

export const ServerMessage = z.union([PushMessage, ResponseMessage])
export type ServerMessage = z.infer<typeof ServerMessage>
