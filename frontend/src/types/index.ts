export type ElementType = 'EPICA' | 'STORIA' | 'TASK' | 'EVENTO'
export type ElementStatus = 'DA_FARE' | 'IN_CORSO' | 'COMPLETATO' | 'ARCHIVIATO'
export type WorkspaceRole = 'ADMIN' | 'COLLABORATORE' | 'GUEST'

export interface User {
  id: string
  email: string
  displayName: string
  mustResetPassword: boolean
  systemAdmin: boolean
  onboardingCompleted?: boolean
  avatar?: string
}

export interface Folder {
  id: string
  parentId?: string
  name: string
  createdBy: string
  createdAt: string
  editableByAll?: boolean
}

export interface DriveFile {
  id: string
  folderId?: string
  filename: string
  contentType?: string
  sizeBytes: number
  uploadedBy: string
  createdAt: string
  lockedBy?: string
  lockedAt?: string
  editableByAll?: boolean
}

export interface LockResult {
  acquired: boolean
  lockedBy?: string
  lockedAt?: string
}

export interface Workspace {
  id: string
  name: string
  description?: string
  myRole: WorkspaceRole
  createdAt: string
  avatar?: string
  cardShowTags?: boolean
  cardShowAssignees?: boolean
  cardShowDueDate?: boolean
  reminderDaysBefore?: number
  eventRemindersEnabled?: boolean
  weeklyRecapEnabled?: boolean
  mondayDigestEnabled?: boolean
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface Element {
  id: string
  workspaceId: string
  parentId?: string
  type: ElementType
  status: ElementStatus
  title: string
  body?: string
  startDate?: string
  endDate?: string
  allDay?: boolean
  position: number
  createdBy: string
  createdAt: string
  updatedAt: string
  tags: Tag[]
  assignees: User[]
  progress?: number
}

export interface Member {
  userId: string
  email: string
  displayName: string
  role: WorkspaceRole
  avatar?: string
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'

export interface Invitation {
  id: string
  workspaceId: string
  workspaceName: string
  email: string
  displayName?: string
  role: WorkspaceRole
  status: InvitationStatus
  expiresAt: string
  createdAt: string
}

export interface InvitationPreview {
  workspaceName: string
  inviterName: string
  email: string
  role: WorkspaceRole
}

// Risposta del login: o autenticazione completa, o richiesta di onboarding (primo accesso).
export interface AuthResponse {
  accessToken: string | null
  refreshToken: string | null
  userId: string
  email: string | null
  displayName: string
  mustResetPassword: boolean
  systemAdmin: boolean
  onboardingCompleted: boolean
  avatar?: string
  onboardingRequired: boolean
  onboardingToken: string | null
}

export interface Attachment {
  id: string
  filename: string
  contentType?: string
  sizeBytes: number
  uploadedBy: string
  createdAt: string
}

export type ApiScope =
  | 'elements:read' | 'elements:write'
  | 'drive:read' | 'drive:write'
  | 'tags:read' | 'tags:write'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: ApiScope[]
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  revoked: boolean
}

export interface CreatedApiKey {
  key: ApiKey
  secret: string
}

export type AiAutonomy = 'READ_ONLY' | 'CONFIRM_DESTRUCTIVE' | 'FULL'
export type AiMemoryMode = 'ADMIN_ONLY' | 'AUTO_AND_ADMIN'

export interface AiSettings {
  enabled: boolean
  apiKeySet: boolean
  apiKeyPreview?: string
  model: string
  temperature: number
  maxTokens: number
  contextWindowTokens: number
  compactThresholdPct: number
  autonomy: AiAutonomy
  memoryMode: AiMemoryMode
  maxToolIterations: number
  personalityMd: string
  memoryMd: string
  toolsMd: string
  updatedAt: string
}

export interface AiTestResult {
  ok: boolean
  message: string
}

export type AiConversationScope = 'PRIVATE' | 'SHARED'
export type AiMessageRole = 'USER' | 'ASSISTANT' | 'TOOL' | 'SYSTEM'

export interface AiConversation {
  id: string
  scope: AiConversationScope
  ownerUserId?: string
  title?: string
  createdAt: string
  updatedAt: string
}

export interface AiMessage {
  id: string
  role: AiMessageRole
  content: string
  authorUserId?: string
  createdAt: string
}

export type WsEventType =
  | 'ELEMENT_CREATED' | 'ELEMENT_UPDATED' | 'ELEMENT_DELETED'
  | 'MESSAGE_CREATED' | 'CHANNEL_CREATED' | 'CHANNEL_UPDATED' | 'CHANNEL_DELETED'
  | 'CHANNEL_READ' | 'TYPING' | 'PRESENCE' | 'DRIVE_CHANGED' | 'AI_MESSAGE' | 'TAG_CHANGED'
  | 'WORKSPACE_DELETED' | 'MEMBER_REMOVED'

export interface WsEvent {
  type: WsEventType
  payload: any
  timestamp: string
}

// --- Chat / Stanze (funzioni Discord-like) ---

export type ChannelType = 'DM' | 'GROUP' | 'ROOM'

export interface ChannelMemberDto {
  userId: string
  displayName: string
  email: string
  avatar?: string
}

export interface ChatMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  authorAvatar?: string
  content: string
  createdAt: string
  editedAt?: string
}

export interface Channel {
  id: string
  type: ChannelType
  name: string
  description?: string
  isPrivate: boolean
  voiceEnabled: boolean
  screenShareEnabled: boolean
  members: ChannelMemberDto[]
  lastMessage?: ChatMessage
  unreadCount: number
  createdAt: string
  updatedAt: string
}
