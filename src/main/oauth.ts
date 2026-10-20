import { BrowserWindow, session } from 'electron'
import { activePolicy, assertHostAllowed } from '@core/policy'
import { authorizeUrl, clientCredentialsToken, createPkce, exchangeCode, parseRedirect, passwordToken, randomState, refreshToken } from '@core/oauth2'
import type { ExecuteOptions } from '@core/executor'
import type { OAuth2Config, OAuth2TokenResult } from '@core/types'

/**
 * Authorization-code grant: show the provider's login page in a modal window and catch the
 * redirect to `redirectUri` before it loads (nothing needs to listen on that address).
 */
function authorizationCode(cfg: OAuth2Config, parent: BrowserWindow | null, opts: ExecuteOptions): Promise<OAuth2TokenResult> {
  if (!cfg.authUrl) return Promise.reject(new Error('Auth URL is required'))
  try {
    assertHostAllowed(cfg.authUrl)
  } catch (e) {
    return Promise.reject(e)
  }
  const state = randomState()
  const pkce = cfg.usePkce ? createPkce() : undefined

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      modal: !!parent,
      title: 'Sign in',
      webPreferences: { partition: 'persist:apiman-oauth', contextIsolation: true, sandbox: true, nodeIntegration: false }
    })
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
      if (!win.isDestroyed()) win.close()
    }
    const onUrl = (event: { preventDefault(): void }, url: string): void => {
      const r = parseRedirect(cfg, url, state)
      if (!r) return
      event.preventDefault()
      if ('error' in r) finish(() => reject(new Error(r.error)))
      else finish(() => exchangeCode(cfg, r.code, pkce?.verifier, opts).then(resolve, reject))
    }
    win.webContents.on('will-redirect', onUrl)
    win.webContents.on('will-navigate', onUrl)
    win.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('Sign-in window was closed'))
      }
    })
    // The sign-in page is a real browser window, so an enforced proxy is applied to its session.
    const proxy = activePolicy().enforcedProxy
    const ready = proxy ? session.fromPartition('persist:apiman-oauth').setProxy({ proxyRules: proxy.url, proxyBypassRules: proxy.bypass }) : Promise.resolve()
    void ready
      .then(() => win.loadURL(authorizeUrl(cfg, state, pkce?.challenge)))
      .catch(() => {
        /* a load error caused by our own preventDefault is expected */
      })
  })
}

export function getToken(cfg: OAuth2Config, parent: BrowserWindow | null, opts: ExecuteOptions): Promise<OAuth2TokenResult> {
  switch (cfg.grantType) {
    case 'client_credentials':
      return clientCredentialsToken(cfg, opts)
    case 'password':
      return passwordToken(cfg, opts)
    case 'authorization_code':
      return authorizationCode(cfg, parent, opts)
  }
}

export const refresh = (cfg: OAuth2Config, opts: ExecuteOptions): Promise<OAuth2TokenResult> => refreshToken(cfg, opts)
