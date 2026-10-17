import { describe, expect, it } from 'vitest'
import { importOpenApi, parseSpecText, sampleFromSchema } from './openapi'
import type { CollectionItem, Folder, RequestItem } from './types'

const yaml = `
openapi: 3.0.3
info: { title: Pet Store, version: '1' }
servers:
  - url: https://{env}.petstore.io/v1
    variables: { env: { default: api } }
tags: [{ name: pets }, { name: store }]
security: [{ bearer: [] }]
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        id: { type: integer, example: 7 }
        name: { type: string }
        tags: { type: array, items: { $ref: '#/components/schemas/Tag' } }
        status: { type: string, enum: [available, sold] }
        owner: { $ref: '#/components/schemas/Pet' }
    Tag: { type: object, properties: { label: { type: string, format: uuid } } }
  parameters:
    PetId: { name: petId, in: path, required: true, schema: { type: integer, example: 42 } }
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer, default: 20 } }
        - { name: cursor, in: query, schema: { type: string } }
        - { name: X-Trace, in: header, schema: { type: string } }
    post:
      tags: [pets]
      operationId: createPet
      requestBody:
        content:
          application/json: { schema: { $ref: '#/components/schemas/Pet' } }
  /pets/{petId}:
    parameters: [{ $ref: '#/components/parameters/PetId' }]
    delete: { tags: [pets], summary: Delete pet, security: [] }
  /store/upload:
    post:
      tags: [store]
      requestBody:
        content:
          multipart/form-data:
            schema: { type: object, properties: { file: { type: string, format: binary }, note: { type: string } } }
  /health: { get: { summary: Health } }
`

const req = (items: CollectionItem[], name: string): RequestItem['request'] => {
  for (const i of items) {
    if (i.type === 'request' && i.request.name === name) return i.request
    if (i.type === 'folder') {
      try {
        return req(i.items, name)
      } catch {
        /* keep looking */
      }
    }
  }
  throw new Error(`no request ${name}`)
}

describe('openapi import', () => {
  it('converts an OpenAPI 3 YAML spec', () => {
    const c = importOpenApi(parseSpecText(yaml))
    expect(c.name).toBe('Pet Store')
    expect(c.items.map((i) => (i.type === 'folder' ? `folder:${i.name}` : i.request.name))).toEqual(['folder:pets', 'folder:store', 'Health'])
    expect(c.variables.map((v) => [v.key, v.value])).toEqual([['baseUrl', 'https://api.petstore.io/v1'], ['petId', '42']])
    expect(c.auth).toEqual({ type: 'bearer', token: '{{bearerToken}}' })

    const list = req(c.items, 'List pets')
    expect(list.url).toBe('{{baseUrl}}/pets?limit=20')
    expect(list.params.map((p) => [p.key, p.enabled])).toEqual([['limit', true], ['cursor', false]])
    expect(list.headers.map((h) => [h.key, h.enabled])).toEqual([['X-Trace', false]])

    const create = req(c.items, 'createPet')
    expect(create.method).toBe('POST')
    if (create.body.mode !== 'raw') throw new Error('expected raw body')
    expect(JSON.parse(create.body.raw)).toEqual({ id: 7, name: 'string', tags: [{ label: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }], status: 'available', owner: {} })

    const del = req(c.items, 'Delete pet')
    expect([del.method, del.url, del.auth.type]).toEqual(['DELETE', '{{baseUrl}}/pets/{{petId}}', 'none'])

    const upload = (c.items[1] as Folder).items[0] as RequestItem
    expect(upload.request.body).toMatchObject({ mode: 'formdata', formdata: [{ key: 'file', type: 'file' }, { key: 'note', type: 'text', value: 'string' }] })
  })

  it('converts a Swagger 2.0 JSON spec with oauth2', () => {
    const c = importOpenApi({
      swagger: '2.0',
      info: { title: 'Legacy' },
      host: 'legacy.io',
      basePath: '/api',
      schemes: ['https'],
      securityDefinitions: { oauth: { type: 'oauth2', flow: 'application', tokenUrl: 'https://legacy.io/token', scopes: { read: '', write: '' } } },
      paths: {
        '/items': {
          post: {
            summary: 'Add item',
            parameters: [{ in: 'body', name: 'body', schema: { type: 'object', properties: { n: { type: 'number' } } } }]
          },
          put: { summary: 'Form', consumes: ['application/x-www-form-urlencoded'], parameters: [{ in: 'formData', name: 'a', type: 'string', default: 'x' }] }
        }
      }
    })
    expect(c.variables[0].value).toBe('https://legacy.io/api')
    expect(c.auth).toMatchObject({ type: 'oauth2', grantType: 'client_credentials', accessTokenUrl: 'https://legacy.io/token', scope: 'read write' })
    expect(req(c.items, 'Add item').body).toEqual({ mode: 'raw', raw: '{\n  "n": 0\n}', language: 'json' })
    expect(req(c.items, 'Form').body).toMatchObject({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'x' }] })
  })

  it('samples allOf / oneOf schemas', () => {
    const doc = { components: { schemas: { A: { type: 'object', properties: { a: { type: 'boolean' } } } } } }
    expect(sampleFromSchema(doc, { allOf: [{ $ref: '#/components/schemas/A' }, { type: 'object', properties: { b: { type: 'string', format: 'date' } } }] })).toEqual({
      a: true,
      b: '2024-01-01'
    })
    expect(sampleFromSchema(doc, { oneOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(0)
  })
})
