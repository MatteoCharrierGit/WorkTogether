import axios from 'axios'
import { useAuthStore } from '@/store/authStore'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Refresh condiviso: tutte le richieste che ricevono 401 contemporaneamente
// (tipico al caricamento pagina) riusano un'unica chiamata a /auth/refresh.
// Senza questa deduplica, ogni richiesta chiamerebbe il refresh con lo stesso
// token; il backend ruota il refresh token, quindi solo la prima andrebbe a
// buon fine e le altre verrebbero disconnesse → logout casuali.
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken
  if (!refreshToken) throw new Error('no refresh token')
  const res = await axios.post('/api/auth/refresh', { refreshToken })
  useAuthStore.getState().setTokens(res.data.accessToken, res.data.refreshToken)
  return res.data.accessToken as string
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    const isRefreshCall = original?.url?.includes('/auth/refresh')
    if (err.response?.status === 401 && original && !original._retry && !isRefreshCall) {
      original._retry = true
      try {
        // Avvia il refresh solo se non ce n'è già uno in corso.
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
        }
        const newAccessToken = await refreshPromise
        original.headers.Authorization = `Bearer ${newAccessToken}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  resetPassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/reset-password', { currentPassword, newPassword }).then(r => r.data),
  logout: () => api.post('/auth/logout'),
}

// Workspaces
export const workspacesApi = {
  list: () => api.get('/workspaces').then(r => r.data),
  create: (name: string, description?: string) =>
    api.post('/workspaces', { name, description }).then(r => r.data),
  getMembers: (wsId: string) => api.get(`/workspaces/${wsId}/members`).then(r => r.data),
  addMember: (wsId: string, userId: string, role: string) =>
    api.post(`/workspaces/${wsId}/members?userId=${userId}&role=${role}`).then(r => r.data),
  updateRole: (wsId: string, userId: string, role: string) =>
    api.patch(`/workspaces/${wsId}/members/${userId}/role?role=${role}`),
  removeMember: (wsId: string, userId: string) =>
    api.delete(`/workspaces/${wsId}/members/${userId}`),
  createUser: (wsId: string, data: { email: string; displayName: string; temporaryPassword: string; role?: string }) =>
    api.post(`/workspaces/${wsId}/users`, data).then(r => r.data),
  updateSettings: (wsId: string, data: { avatar?: string; cardShowTags?: boolean; cardShowAssignees?: boolean; cardShowDueDate?: boolean; reminderDaysBefore?: number; eventRemindersEnabled?: boolean; weeklyRecapEnabled?: boolean; mondayDigestEnabled?: boolean }) =>
    api.patch(`/workspaces/${wsId}/settings`, data).then(r => r.data),
  // Backup / trasporto: export delle sezioni selezionate → JSON; import → nuova workspace.
  exportWorkspace: (wsId: string, sections: { settings?: boolean; members?: boolean; tags?: boolean; elements?: boolean; chat?: boolean; ai?: boolean }) =>
    api.post(`/workspaces/${wsId}/export`, sections).then(r => r.data),
  importWorkspace: (data: unknown, newName?: string) =>
    api.post(`/workspaces/import`, { data, newName }).then(r => r.data),
  deleteWorkspace: (wsId: string) =>
    api.delete(`/workspaces/${wsId}`),
}

// Elements
export const elementsApi = {
  list: (wsId: string) => api.get(`/workspaces/${wsId}/elements`).then(r => r.data),
  get: (wsId: string, id: string) => api.get(`/workspaces/${wsId}/elements/${id}`).then(r => r.data),
  create: (wsId: string, data: object) =>
    api.post(`/workspaces/${wsId}/elements`, data).then(r => r.data),
  update: (wsId: string, id: string, data: object) =>
    api.put(`/workspaces/${wsId}/elements/${id}`, data).then(r => r.data),
  delete: (wsId: string, id: string) => api.delete(`/workspaces/${wsId}/elements/${id}`),
}

// Tags
export const tagsApi = {
  list: (wsId: string) => api.get(`/workspaces/${wsId}/tags`).then(r => r.data),
  create: (wsId: string, data: { name: string; color?: string }) =>
    api.post(`/workspaces/${wsId}/tags`, data).then(r => r.data),
  update: (wsId: string, id: string, data: { name: string; color?: string }) =>
    api.put(`/workspaces/${wsId}/tags/${id}`, data).then(r => r.data),
  delete: (wsId: string, id: string) => api.delete(`/workspaces/${wsId}/tags/${id}`),
}

// Users
export const usersApi = {
  me: () => api.get('/users/me').then(r => r.data),
  all: () => api.get('/users').then(r => r.data),
  myTasks: () => api.get('/users/me/tasks').then(r => r.data),
  updateProfile: (data: { displayName?: string; avatar?: string }) =>
    api.patch('/users/me', data).then(r => r.data),
  completeOnboarding: () => api.post('/users/me/complete-onboarding').then(r => r.data),
}

// Drive (file condivisi)
export const driveApi = {
  listFolders: (wsId: string, parentId?: string) =>
    api.get(`/workspaces/${wsId}/drive/folders`, { params: parentId ? { parentId } : {} }).then(r => r.data),
  createFolder: (wsId: string, name: string, parentId?: string) =>
    api.post(`/workspaces/${wsId}/drive/folders`, { name, parentId }).then(r => r.data),
  deleteFolder: (wsId: string, folderId: string) =>
    api.delete(`/workspaces/${wsId}/drive/folders/${folderId}`),
  moveFolder: (wsId: string, folderId: string, targetFolderId?: string) =>
    api.patch(`/workspaces/${wsId}/drive/folders/${folderId}/move`, { targetFolderId: targetFolderId ?? null }).then(r => r.data),
  renameFolder: (wsId: string, folderId: string, name: string) =>
    api.patch(`/workspaces/${wsId}/drive/folders/${folderId}/rename`, { name }).then(r => r.data),
  listFiles: (wsId: string, folderId?: string) =>
    api.get(`/workspaces/${wsId}/drive/files`, { params: folderId ? { folderId } : {} }).then(r => r.data),
  upload: (wsId: string, file: File, folderId?: string, onProgress?: (percent: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post(`/workspaces/${wsId}/drive/files`, form, {
        params: folderId ? { folderId } : {},
        onUploadProgress: e => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      .then(r => r.data)
  },
  deleteFile: (wsId: string, fileId: string) =>
    api.delete(`/workspaces/${wsId}/drive/files/${fileId}`),
  moveFile: (wsId: string, fileId: string, targetFolderId?: string) =>
    api.patch(`/workspaces/${wsId}/drive/files/${fileId}/move`, { targetFolderId: targetFolderId ?? null }).then(r => r.data),
  renameFile: (wsId: string, fileId: string, name: string) =>
    api.patch(`/workspaces/${wsId}/drive/files/${fileId}/rename`, { name }).then(r => r.data),
  copyFile: (wsId: string, fileId: string) =>
    api.post(`/workspaces/${wsId}/drive/files/${fileId}/copy`).then(r => r.data),
  download: async (wsId: string, fileId: string, filename: string) => {
    const res = await api.get(`/workspaces/${wsId}/drive/files/${fileId}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
  // Recupera il file come Blob (per anteprima immagini/PDF) — il chiamante revoca l'URL.
  fetchBlob: (wsId: string, fileId: string) =>
    api.get(`/workspaces/${wsId}/drive/files/${fileId}`, { responseType: 'blob' }).then(r => r.data as Blob),
  // Recupera il contenuto testuale del file.
  fetchText: (wsId: string, fileId: string) =>
    api.get(`/workspaces/${wsId}/drive/files/${fileId}`, { responseType: 'text' }).then(r => r.data as string),
  saveContent: (wsId: string, fileId: string, content: string) =>
    api.put(`/workspaces/${wsId}/drive/files/${fileId}/content`, { content }).then(r => r.data),
  lock: (wsId: string, fileId: string) =>
    api.post(`/workspaces/${wsId}/drive/files/${fileId}/lock`).then(r => r.data),
  unlock: (wsId: string, fileId: string) =>
    api.delete(`/workspaces/${wsId}/drive/files/${fileId}/lock`),
}

// API keys (integrazioni esterne)
export const apiKeysApi = {
  list: (wsId: string) => api.get(`/workspaces/${wsId}/api-keys`).then(r => r.data),
  create: (wsId: string, data: { name: string; scopes: string[]; expiresInDays?: number | null }) =>
    api.post(`/workspaces/${wsId}/api-keys`, data).then(r => r.data),
  delete: (wsId: string, keyId: string) =>
    api.delete(`/workspaces/${wsId}/api-keys/${keyId}`),
}

// Handler per lo streaming SSE dell'agente.
export interface AiStreamHandlers {
  onToken: (t: string) => void
  onTool?: (name: string) => void
  onConfirm?: (actions: any[]) => void
  onDone?: () => void
  onError?: (m: string) => void
}

// Legge una risposta SSE via fetch (per poter inviare il Bearer token).
async function aiStreamSse(path: string, body: object, handlers: AiStreamHandlers) {
  const token = useAuthStore.getState().accessToken
  const base = (import.meta as any).env?.VITE_API_URL || '/api'
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch {
    handlers.onError?.('Errore di rete')
    return
  }
  if (!res.ok || !res.body) {
    let msg = 'Errore nella richiesta'
    try { const j = await res.json(); msg = j.error || msg } catch { /* ignore */ }
    handlers.onError?.(msg)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const evt of events) {
      const dataLine = evt.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      const payload = dataLine.slice(5).trim()
      if (!payload) continue
      try {
        const ev = JSON.parse(payload)
        if (ev.type === 'token') handlers.onToken(ev.text)
        else if (ev.type === 'tool') handlers.onTool?.(ev.name)
        else if (ev.type === 'confirm') handlers.onConfirm?.(ev.actions || [])
        else if (ev.type === 'done') handlers.onDone?.()
        else if (ev.type === 'error') handlers.onError?.(ev.message || 'Errore')
      } catch { /* frammento non-JSON */ }
    }
  }
}

// Agente AI
export const aiApi = {
  getSettings: (wsId: string) => api.get(`/workspaces/${wsId}/ai/settings`).then(r => r.data),
  updateSettings: (wsId: string, data: object) =>
    api.put(`/workspaces/${wsId}/ai/settings`, data).then(r => r.data),
  testConnection: (wsId: string, apiKey?: string) =>
    api.post(`/workspaces/${wsId}/ai/test`, apiKey ? { apiKey } : {}).then(r => r.data),
  listModels: (wsId: string): Promise<{ id: string; name: string }[]> =>
    api.get(`/workspaces/${wsId}/ai/models`).then(r => r.data),
  status: (wsId: string) => api.get(`/workspaces/${wsId}/ai/status`).then(r => r.data),

  listConversations: (wsId: string, scope: string) =>
    api.get(`/workspaces/${wsId}/ai/conversations`, { params: { scope } }).then(r => r.data),
  createConversation: (wsId: string, data: { scope: string; title?: string }) =>
    api.post(`/workspaces/${wsId}/ai/conversations`, data).then(r => r.data),
  getMessages: (wsId: string, convId: string) =>
    api.get(`/workspaces/${wsId}/ai/conversations/${convId}/messages`).then(r => r.data),
  deleteConversation: (wsId: string, convId: string) =>
    api.delete(`/workspaces/${wsId}/ai/conversations/${convId}`),

  // Invio messaggio con risposta in streaming.
  streamMessage: (wsId: string, convId: string, text: string, handlers: AiStreamHandlers) =>
    aiStreamSse(`/workspaces/${wsId}/ai/conversations/${convId}/messages`, { text }, handlers),

  // Conferma/annulla le azioni in attesa e riprende lo stream.
  confirmActions: (wsId: string, convId: string, confirm: boolean, handlers: AiStreamHandlers) =>
    aiStreamSse(`/workspaces/${wsId}/ai/conversations/${convId}/confirm`, { confirm }, handlers),

  // Comandi slash (es. /context, /compact, /model).
  command: (wsId: string, convId: string, command: string, arg?: string): Promise<{ message: string; refreshMessages: boolean; refreshConversations: boolean }> =>
    api.post(`/workspaces/${wsId}/ai/conversations/${convId}/command`, { command, arg }).then(r => r.data),
}

// Email (invio per ruoli, admin)
export const emailApi = {
  send: (wsId: string, data: { roles: string[]; subject: string; body: string }): Promise<{ recipientCount: number }> =>
    api.post(`/workspaces/${wsId}/emails/send`, data).then(r => r.data),
  draft: (wsId: string, data: { prompt: string; roles?: string[] }): Promise<{ subject: string; body: string }> =>
    api.post(`/workspaces/${wsId}/emails/draft`, data).then(r => r.data),
}

// Chat / Stanze (funzioni Discord-like)
export const channelsApi = {
  list: (wsId: string) => api.get(`/workspaces/${wsId}/channels`).then(r => r.data),
  listRooms: (wsId: string) => api.get(`/workspaces/${wsId}/channels/rooms`).then(r => r.data),
  createDm: (wsId: string, userId: string) =>
    api.post(`/workspaces/${wsId}/channels/dm`, { userId }).then(r => r.data),
  createGroup: (wsId: string, data: { name: string; memberIds: string[] }) =>
    api.post(`/workspaces/${wsId}/channels/groups`, data).then(r => r.data),
  createRoom: (wsId: string, data: { name: string; description?: string; isPrivate: boolean; voiceEnabled: boolean; screenShareEnabled: boolean; memberIds: string[] }) =>
    api.post(`/workspaces/${wsId}/channels/rooms`, data).then(r => r.data),
  updateRoom: (wsId: string, roomId: string, data: { name: string; description?: string; isPrivate: boolean; voiceEnabled: boolean; screenShareEnabled: boolean; memberIds: string[] }) =>
    api.put(`/workspaces/${wsId}/channels/rooms/${roomId}`, data).then(r => r.data),
  deleteRoom: (wsId: string, roomId: string) =>
    api.delete(`/workspaces/${wsId}/channels/rooms/${roomId}`),
  getMessages: (wsId: string, channelId: string, params?: { before?: string; limit?: number }) =>
    api.get(`/workspaces/${wsId}/channels/${channelId}/messages`, { params }).then(r => r.data),
  sendMessage: (wsId: string, channelId: string, content: string) =>
    api.post(`/workspaces/${wsId}/channels/${channelId}/messages`, { content }).then(r => r.data),
  markRead: (wsId: string, channelId: string) =>
    api.post(`/workspaces/${wsId}/channels/${channelId}/read`),
  typing: (wsId: string, channelId: string) =>
    api.post(`/workspaces/${wsId}/channels/${channelId}/typing`),
  voiceToken: (wsId: string, channelId: string): Promise<VoiceToken> =>
    api.post(`/workspaces/${wsId}/channels/${channelId}/voice/token`).then(r => r.data),
}

export interface VoiceToken {
  url: string
  token: string
  identity: string
  roomName: string
}

export interface PresenceEntryDto { userId: string; inCallChannelId: string | null }

export const presenceApi = {
  heartbeat: (wsId: string, channelId: string | null): Promise<PresenceEntryDto[]> =>
    api.post(`/workspaces/${wsId}/presence/heartbeat`, { channelId }).then(r => r.data),
  get: (wsId: string): Promise<PresenceEntryDto[]> =>
    api.get(`/workspaces/${wsId}/presence`).then(r => r.data),
}

// Attachments
export const attachmentsApi = {
  list: (wsId: string, elementId: string) =>
    api.get(`/workspaces/${wsId}/elements/${elementId}/attachments`).then(r => r.data),
  upload: (wsId: string, elementId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post(`/workspaces/${wsId}/elements/${elementId}/attachments`, form)
      .then(r => r.data)
  },
  delete: (wsId: string, elementId: string, attId: string) =>
    api.delete(`/workspaces/${wsId}/elements/${elementId}/attachments/${attId}`),
  // Scarica con il token e forza il download nel browser.
  download: async (wsId: string, elementId: string, attId: string, filename: string) => {
    const res = await api.get(
      `/workspaces/${wsId}/elements/${elementId}/attachments/${attId}`,
      { responseType: 'blob' }
    )
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
