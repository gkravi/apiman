import { nanoid } from 'nanoid'
import {
  DEFAULT_SETTINGS,
  type ApiRequest,
  type Collection,
  type Environment,
  type Folder,
  type KeyValue,
  type RequestItem
} from './types'

export const uid = (): string => nanoid(12)

export const newKeyValue = (key = '', value = '', enabled = true): KeyValue => ({
  id: uid(),
  key,
  value,
  enabled
})

export const newRequest = (partial: Partial<ApiRequest> = {}): ApiRequest => ({
  id: uid(),
  name: 'New Request',
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  settings: { ...DEFAULT_SETTINGS },
  ...partial
})

export const newRequestItem = (request: ApiRequest = newRequest()): RequestItem => ({
  id: request.id,
  type: 'request',
  request
})

export const newFolder = (name = 'New Folder'): Folder => ({ id: uid(), type: 'folder', name, items: [] })

export const newCollection = (name = 'New Collection'): Collection => ({
  id: uid(),
  name,
  items: [],
  variables: [],
  auth: { type: 'none' }
})

export const newEnvironment = (name = 'New Environment'): Environment => ({
  id: uid(),
  name,
  variables: []
})
