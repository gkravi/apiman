import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from './api'

const api: Api = {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (ws) => ipcRenderer.invoke('workspace:save', ws),
  execute: (id, req) => ipcRenderer.invoke('http:execute', id, req),
  cancel: (id) => ipcRenderer.invoke('http:cancel', id),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  openJson: () => ipcRenderer.invoke('dialog:openJson'),
  saveJson: (name, content) => ipcRenderer.invoke('dialog:saveJson', name, content),
  saveBinary: (name, base64) => ipcRenderer.invoke('dialog:saveBinary', name, base64)
}

contextBridge.exposeInMainWorld('api', api)
