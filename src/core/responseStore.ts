// The latest response of each request in this process (the app's main process, or one CLI run),
// keyed by request id. $response(...) reads it to decide whether a referenced request needs sending.

import type { ApiResponse } from './types'

const store = new Map<string, { response: ApiResponse; at: number }>()

export const rememberResponse = (requestId: string, response: ApiResponse): void => void store.set(requestId, { response, at: Date.now() })
export const lastResponse = (requestId: string): { response: ApiResponse; at: number } | undefined => store.get(requestId)
export const forgetResponses = (): void => store.clear()
