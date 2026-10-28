import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Resource } from '#models'

const resource = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Acme Widgets',
  description: 'A widget company',
  createdAt: '2025-06-01T10:45:29.323Z',
  updatedAt: '2025-06-01T10:45:29.323Z',
}

test('Resource parses a complete resource', () => {
  expect(Resource.parse(resource)).toEqual(resource)
})

test('Resource trims name and description', () => {
  expect(
    Resource.parse({
      ...resource,
      name: '  Acme Widgets  ',
      description: '  A widget company  ',
    }),
  ).toEqual(resource)
})

test('Resource rejects a name under 2 characters after trimming', () => {
  expect(Resource.safeParse({ ...resource, name: 'a' }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, name: ' a ' }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, name: '  ' }).success).toBe(false)
})

test('Resource rejects a name over 64 characters', () => {
  expect(Resource.safeParse({ ...resource, name: 'a'.repeat(64) }).success).toBe(true)
  expect(Resource.safeParse({ ...resource, name: 'a'.repeat(65) }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, name: ` ${'a'.repeat(65)} ` }).success).toBe(false)
})

test('Resource accepts an omitted or null description', () => {
  const { description: _description, ...withoutDescription } = resource

  expect(Resource.parse(withoutDescription)).toEqual(withoutDescription)
  expect(Resource.parse({ ...resource, description: null })).toEqual({ ...resource, description: null })
})

test('Resource rejects a blank description', () => {
  expect(Resource.safeParse({ ...resource, description: '' }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, description: '   ' }).success).toBe(false)
})

test('Resource rejects a description over 128 characters', () => {
  expect(Resource.safeParse({ ...resource, description: 'a'.repeat(128) }).success).toBe(true)
  expect(Resource.safeParse({ ...resource, description: 'a'.repeat(129) }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, description: ` ${'a'.repeat(129)} ` }).success).toBe(false)
})

test('Resource rejects an id that is not a UUID', () => {
  expect(Resource.safeParse({ ...resource, id: 'not-a-uuid' }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, id: '123e4567e89b12d3a456426614174000' }).success).toBe(false)
})

test('Resource rejects a timestamp without a Z suffix', () => {
  const withoutZone = '2025-06-01T10:45:29.323'
  const withOffset = '2025-06-01T10:45:29.323+10:00'

  expect(Resource.safeParse({ ...resource, createdAt: withoutZone }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, updatedAt: withoutZone }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, createdAt: withOffset }).success).toBe(false)
  expect(Resource.safeParse({ ...resource, updatedAt: withOffset }).success).toBe(false)
})

test('Resource carries OpenAPI descriptions, examples and date-time formats', () => {
  expect(z.toJSONSchema(Resource)).toMatchObject({
    properties: {
      id: {
        description: 'The unique identifier for the resource',
        example: '123e4567-e89b-12d3-a456-426614174000',
      },
      name: {
        description: 'The name of the object',
        example: 'Acme Widgets',
      },
      description: {
        description: 'The description of the object',
        example: 'A widget company',
      },
      createdAt: {
        description: 'The date and time the object was created',
        format: 'date-time',
        example: '2025-06-01T10:45:29.323Z',
      },
      updatedAt: {
        description: 'The date and time the object was last updated',
        format: 'date-time',
        example: '2025-06-01T10:45:29.323Z',
      },
    },
  })
})
