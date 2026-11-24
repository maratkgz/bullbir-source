// Request body validation at the boundary: read JSON, check it against a zod schema, and report
// only field names (never the submitted values, which may be passwords).
import { z } from 'zod'
import { AppError } from './errors.js'
import { readJson, type ApiRequest } from './http.js'

export async function parseBody<S extends z.ZodType>(req: ApiRequest, schema: S): Promise<z.output<S>> {
  const result = schema.safeParse(await readJson(req))
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(body)'))]
    throw new AppError('validation_failed', `Invalid fields: ${fields.join(', ')}`)
  }
  return result.data
}
