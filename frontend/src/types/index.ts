export type ElementType = 'EPICA' | 'STORIA' | 'TASK' | 'EVENTO'
export type ElementStatus = 'DA_FARE' | 'IN_CORSO' | 'COMPLETATO' | 'ARCHIVIATO'
export type WorkspaceRole = 'ADMIN' | 'COLLABORATORE' | 'GUEST'

export interface User {
  id: string
  /** null per account legacy mai collegati a un'email verificata. */
  email: string | null
  displayName: string
  systemAdmin: boolean
  onboardingCompleted?: boolean
  avatar?: string
}

/** Risposta di POST /admin/users: l'utente creato più l'esito dell'email di invito. */
export interface CreatedUser extends User {
  /** true se l'email con le credenziali è partita. */
  inviteSent: boolean
  /** Motivo per cui l'invito non è partito (null se non richiesto o inviato). */
  inviteError?: string | null
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
  sprintEnabled?: boolean
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
  sprintId?: string
  completedAt?: string
  blocked?: boolean
}

export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED'
export type SprintCarryOver = 'BACKLOG' | 'NEXT_SPRINT'

export interface Sprint {
  id: string
  workspaceId: string
  name: string
  goal?: string
  startDate?: string
  endDate?: string
  actualStartAt?: string
  actualEndAt?: string
  status: SprintStatus
  retrospectiveMd?: string
  position: number
  createdBy?: string
  createdAt: string
  taskTotal: number
  taskCompleted: number
  channelId?: string
}

export interface SprintDetail {
  sprint: Sprint | null
  tasks: Element[]
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
  | 'members:read'
  | 'sprints:read' | 'sprints:write'

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
  | 'WORKSPACE_DELETED' | 'MEMBER_REMOVED' | 'SPRINT_CHANGED'
  | 'MEMBER_ADDED' | 'MEMBER_ROLE_CHANGED' | 'WORKSPACE_UPDATED'

export interface WsEvent {
  type: WsEventType
  payload: any
  timestamp: string
}

// --- Chat / Stanze (funzioni Discord-like) ---

export type ChannelType = 'DM' | 'GROUP' | 'ROOM' | 'SPRINT'

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

// --- Notifiche e priorità ---

export type ElementPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

// Declaration merging: aggiunge il campo priorità all'interfaccia Element sopra.
export interface Element {
  priority?: ElementPriority
}

export type NotificationType =
  | 'ASSIGNED' | 'ELEMENT_STATUS' | 'DUE_SOON' | 'OVERDUE' | 'SPRINT_STARTED' | 'SPRINT_CLOSED' | 'MENTION'

/** Eventi della coda personale aggiunti da questo pacchetto (payload: AppNotification / {ids}|{all}). */
export type NotificationWsEventType = 'NOTIFICATION' | 'NOTIFICATIONS_READ'

export interface AppNotification {
  id: string
  workspaceId?: string | null
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  actorId?: string | null
  actorName?: string | null
  actorAvatar?: string | null
  elementId?: string | null
  readAt?: string | null
  createdAt: string
}

export type NotificationPreferences = Record<NotificationType, boolean>

// --- Avatar, sicurezza WS e modalità nascosta ---
// Le foto profilo non viaggiano più come data URL base64 nei JSON: `avatarUrl` (e l'alias legacy
// `avatar`, stesso valore) è un URL versionato `/api/users/{id}/avatar?v=N` servito con cache.
export interface User {
  avatarUrl?: string
}
export interface ChannelMemberDto {
  avatarUrl?: string
}
export interface Member {
  avatarUrl?: string
  /** Admin in modalità invisibile (visibile solo agli admin e all'interessato). */
  hidden?: boolean
}

// --- AI (provider, modelli per utente, limiti, consumi) ---
export type AiProvider = 'OPENROUTER' | 'ANTHROPIC'

export interface AiSettings {
  provider: AiProvider
  anthropicApiKeySet: boolean
  anthropicApiKeyPreview?: string | null
  anthropicModel: string
  ratePerMinute: number
  ratePerDay: number
  maxConcurrent: number
  automationDailyCap: number
}

export interface AiModelInfo { id: string; name: string }

export interface AiModelCatalog {
  provider: AiProvider
  /** false = elenco statico di riserva (provider non raggiungibile o chiave mancante). */
  live: boolean
  error?: string | null
  models: AiModelInfo[]
}

export interface AiUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface AiLimits { perMinute: number; perDay: number; maxConcurrent: number }

export interface AiMe {
  enabled: boolean
  provider: AiProvider
  model: string
  /** USER = assegnato dall'admin, WORKSPACE = predefinito del workspace. */
  modelSource: 'USER' | 'WORKSPACE'
  admin: boolean
  limits: AiLimits
  usageToday: AiUsageTotals
  inFlight: number
}

export interface AiUserRow {
  userId: string
  displayName: string
  email?: string | null
  role: string
  openrouterModel?: string | null
  anthropicModel?: string | null
  effectiveModel: string
  modelSource: 'USER' | 'WORKSPACE'
  ratePerMinute?: number | null
  ratePerDay?: number | null
  effectiveLimits: AiLimits
  usageToday: AiUsageTotals
  usagePeriod: AiUsageTotals
}

export interface AiUsageReport {
  from: string
  to: string
  days: number
  totalToday: AiUsageTotals
  totalPeriod: AiUsageTotals
  users: { userId: string; displayName: string; today: AiUsageTotals; period: AiUsageTotals }[]
  automationsToday: AiUsageTotals
  automationsPeriod: AiUsageTotals
  daily: { day: string; requests: number; inputTokens: number; outputTokens: number }[]
}

// --- Dashboard ---
/** GET /api/workspaces/{wsId}/dashboard — conteggi sui soli TASK non archiviati (fuso Europe/Rome). */
export interface DashboardTaskItem {
  id: string
  title: string
  status: ElementStatus
  priority: ElementPriority
  endDate?: string | null
  blocked: boolean
}

export interface DashboardData {
  generatedAt: string
  counts: {
    todo: number
    inProgress: number
    done: number
    overdue: number
    dueThisWeek: number
    blocked: number
    unassigned: number
  }
  openByPriority: { priority: ElementPriority; count: number }[]
  me: { openCount: number; overdueCount: number; dueThisWeekCount: number; next: DashboardTaskItem[] }
  activeSprint: {
    id: string
    name: string
    goal?: string | null
    startDate?: string | null
    endDate?: string | null
    total: number
    done: number
    inProgress: number
    blocked: number
    /** Giorni alla fine prevista (negativo = superata, null = senza data). */
    daysLeft?: number | null
  } | null
  epics: { id: string; title: string; status: ElementStatus; endDate?: string | null; total: number; done: number }[]
  throughput: { days: { date: string; count: number }[]; total: number; previousTotal: number }
  workload: { userId: string; displayName: string; avatarUrl?: string | null; open: number; inProgress: number; overdue: number }[]
}
