import { buildSchema, introspectionFromSchema } from 'graphql'
import { describe, expect, it } from 'vitest'
import { introspectionRequest, schemaFromResponse } from './graphql'
import { newRequest } from './factory'

describe('graphql introspection', () => {
  const sdl = buildSchema('type Query { user(id: ID!): User } type User { id: ID! name: String }')

  it('builds a POST introspection request that keeps url, headers and auth but drops scripts', () => {
    const req = newRequest({ url: '{{api}}/graphql', auth: { type: 'bearer', token: 't' }, scripts: { preRequest: 'x', test: 'y' } })
    const intro = introspectionRequest(req)
    expect(intro).toMatchObject({ method: 'POST', url: '{{api}}/graphql', auth: { type: 'bearer', token: 't' }, scripts: undefined })
    expect(intro.body.mode === 'graphql' && intro.body.query).toContain('__schema')
  })

  it('turns an introspection response into a schema', () => {
    const schema = schemaFromResponse(200, JSON.stringify({ data: introspectionFromSchema(sdl) }))
    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual(['user'])
    expect(schema.getType('User')).toBeDefined()
  })

  it('explains failures', () => {
    expect(() => schemaFromResponse(500, '<html>')).toThrow('response is not JSON')
    expect(() => schemaFromResponse(200, JSON.stringify({ errors: [{ message: 'introspection disabled' }] }))).toThrow('introspection disabled')
    expect(() => schemaFromResponse(200, '{"data":{}}')).toThrow('no __schema')
  })
})
