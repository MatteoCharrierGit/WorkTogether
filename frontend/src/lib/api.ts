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

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const refreshToken = useAuthStore.getState().refreshToken
        const res = await axios.post('/api/auth/refresh', { refreshToken })
        useAuthStore.getState().setTokens(res.data.accessToken, res.data.refreshToken)
        original.headers.Authorization = `Bearer ${res.data.accessToken}`
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
  updateSettings: (wsId: string, data: { avatar?: string; cardShowTags?: boolean; cardShowAssignees?: boolean; cardShowDueDate?: boolean }) =>
    api.patch(`/workspaces/${wsId}/settings`, data).then(r => r.data),
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
}

// Drive (file condivisi)
export const driveApi = {
  listFolders: (wsId: string, parentId?: string) =>
    api.get(`/workspaces/${wsId}/drive/folders`, { params: parentId ? { parentId } : {} }).then(r => r.data),
  createFolder: (wsId: string, name: string, parentId?: string) =>
    api.post(`/workspaces/${wsId}/drive/folders`, { name, parentId }).then(r => r.data),
  deleteFolder: (wsId: string, folderId: string) =>
    api.delete(`/workspaces/${wsId}/drive/folders/${folderId}`),
  listFiles: (wsId: string, folderId?: string) =>
    api.get(`/workspaces/${wsId}/drive/files`, { params: folderId ? { folderId } : {} }).then(r => r.data),
  upload: (wsId: string, file: File, folderId?: string) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post(`/workspaces/${wsId}/drive/files`, form, { params: folderId ? { folderId } : {} })
      .then(r => r.data)
  },
  deleteFile: (wsId: string, fileId: string) =>
    api.delete(`/workspaces/${wsId}/drive/files/${fileId}`),
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
