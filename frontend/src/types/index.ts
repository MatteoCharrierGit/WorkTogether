export type ElementType = 'EPICA' | 'STORIA' | 'TASK' | 'EVENTO'
export type ElementStatus = 'DA_FARE' | 'IN_CORSO' | 'COMPLETATO' | 'ARCHIVIATO'
export type WorkspaceRole = 'ADMIN' | 'COLLABORATORE' | 'GUEST'

export interface User {
  id: string
  email: string
  displayName: string
  mustResetPassword: boolean
  systemAdmin: boolean
  avatar?: string
}

export interface Folder {
  id: string
  parentId?: string
  name: string
  createdBy: string
  createdAt: string
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

export interface Attachment {
  id: string
  filename: string
  contentType?: string
  sizeBytes: number
  uploadedBy: string
  createdAt: string
}

export interface WsEvent {
  type: 'ELEMENT_CREATED' | 'ELEMENT_UPDATED' | 'ELEMENT_DELETED'
  payload: Element | { id: string }
  timestamp: string
}
