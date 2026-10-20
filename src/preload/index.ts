import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from './api'

const api: Api = {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (ws) => ipcRenderer.invoke('workspace:save', ws),
  runRequest: (id, input) => ipcRenderer.invoke('run:request', id, input),
  cancel: (id) => ipcRenderer.invoke('run:cancel', id),
  startRunner: (runId, steps, vars, options, ctx) => ipcRenderer.invoke('runner:start', runId, steps, vars, options, ctx),
  oauth2Token: (cfg, ctx) => ipcRenderer.invoke('oauth2:token', cfg, ctx),
  oauth2Refresh: (cfg, ctx) => ipcRenderer.invoke('oauth2:refresh', cfg, ctx),
  onRunnerResult: (cb) => {
    const listener = (_e: IpcRendererEvent, runId: string, result: Parameters<typeof cb>[1]): void => cb(runId, result)
    ipcRenderer.on('runner:result', listener)
    return () => ipcRenderer.removeListener('runner:result', listener)
  },
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  pickFiles: (extensions) => ipcRenderer.invoke('dialog:pickFiles', extensions),
  realtimeOpen: (id, input) => ipcRenderer.invoke('rt:open', id, input),
  realtimeSend: (id, data) => ipcRenderer.invoke('rt:send', id, data),
  realtimeEnd: (id) => ipcRenderer.invoke('rt:end', id),
  realtimeClose: (id) => ipcRenderer.invoke('rt:close', id),
  onRealtimeEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, id: string, ev: Parameters<typeof cb>[1]): void => cb(id, ev)
    ipcRenderer.on('rt:event', listener)
    return () => ipcRenderer.removeListener('rt:event', listener)
  },
  mockStart: (id, collection, port) => ipcRenderer.invoke('mock:start', id, collection, port),
  mockStop: (id) => ipcRenderer.invoke('mock:stop', id),
  mockUpdate: (id, collection) => ipcRenderer.invoke('mock:update', id, collection),
  onMockLog: (cb) => {
    const listener = (_e: IpcRendererEvent, id: string, entry: Parameters<typeof cb>[1]): void => cb(id, entry)
    ipcRenderer.on('mock:log', listener)
    return () => ipcRenderer.removeListener('mock:log', listener)
  },
  grpcDescribe: (input) => ipcRenderer.invoke('grpc:describe', input),
  openJson: () => ipcRenderer.invoke('dialog:openJson'),
  openDataFile: () => ipcRenderer.invoke('dialog:openData'),
  saveJson: (name, content) => ipcRenderer.invoke('dialog:saveJson', name, content),
  saveBinary: (name, base64) => ipcRenderer.invoke('dialog:saveBinary', name, base64),
  saveText: (name, content, extensions) => ipcRenderer.invoke('dialog:saveText', name, content, extensions),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  getPolicy: () => ipcRenderer.invoke('policy:get')
}

contextBridge.exposeInMainWorld('api', api)
