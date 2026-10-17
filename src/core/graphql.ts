// GraphQL helpers: build the introspection request for an editor request, and turn the response
// into a schema for autocomplete/validation. Pure — runs in the renderer.

import { buildClientSchema, getIntrospectionQuery, type GraphQLSchema, type IntrospectionQuery } from 'graphql'
import type { ApiRequest } from './types'

/** Same URL, headers and auth as the request, but POSTing the standard introspection query. */
export function introspectionRequest(req: ApiRequest): ApiRequest {
  return {
    ...req,
    method: 'POST',
    body: { mode: 'graphql', query: getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true }), variables: '' },
    scripts: undefined
  }
}

export function schemaFromResponse(status: number, body: string): GraphQLSchema {
  let json: { data?: IntrospectionQuery; errors?: { message: string }[] }
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`Introspection failed: HTTP ${status}, response is not JSON`)
  }
  if (json.errors?.length && !json.data) throw new Error(`Introspection failed: ${json.errors.map((e) => e.message).join('; ')}`)
  if (!json.data?.__schema) throw new Error(`Introspection failed: HTTP ${status}, no __schema in response (introspection may be disabled)`)
  return buildClientSchema(json.data)
}
