import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from './api'

const api: Api = {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (ws) => ipcRenderer.invoke('workspace:save', ws),
  runRequest: (id, input) => ipcRenderer.invoke('run:request', id, input),
  cancel: (id) => ipcRenderer.invoke('run:cancel', id),
  startRunner: (runId, steps, vars, options) => ipcRenderer.invoke('runner:start', runId, steps, vars, options),
  onRunnerResult: (cb) => {
    const listener = (_e: IpcRendererEvent, runId: string, result: Parameters<typeof cb>[1]): void => cb(runId, result)
    ipcRenderer.on('runner:result', listener)
    return () => ipcRenderer.removeListener('runner:result', listener)
  },
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  openJson: () => ipcRenderer.invoke('dialog:openJson'),
  openDataFile: () => ipcRenderer.invoke('dialog:openData'),
  saveJson: (name, content) => ipcRenderer.invoke('dialog:saveJson', name, content),
  saveBinary: (name, base64) => ipcRenderer.invoke('dialog:saveBinary', name, base64)
}

contextBridge.exposeInMainWorld('api', api)
