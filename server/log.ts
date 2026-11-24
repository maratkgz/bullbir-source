// Structured JSON logs that can never contain secrets: values under sensitive keys are replaced,
// e-mail addresses are masked, long opaque strings (tokens) are truncated.

type Level = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

const SENSITIVE_KEY = /pass|secret|token|code|otp|cookie|authori[sz]ation|pepper|hash|salt|key|session|credential|private/i
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
const OPAQUE = /\b[A-Za-z0-9_\-+/=.]{40,}\b/g
const MAX_DEPTH = 6
const REDACTED = '[redacted]'

function scrubString(value: string): string {
  return value.replace(EMAIL, '$1***@$2').replace(OPAQUE, (m) => `${m.slice(0, 6)}…[${m.length}]`)
}

/** Deep copy with secrets removed. Exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth]'
  if (typeof value === 'string') return scrubString(value)
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), stack: value.stack && scrubString(value.stack) }
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1)]),
    )
  }
  return value
}

type Sink = (line: string, level: Level) => void

const defaultSink: Sink = (line, level) => {
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  out.write(`${line}\n`)
}

let sink: Sink = defaultSink

/** Test helper: capture log lines. Returns a restore function. */
export function captureLogs(collect: (line: string) => void): () => void {
  sink = (line) => collect(line)
  return () => { sink = defaultSink }
}

function write(level: Level, msg: string, fields: LogFields = {}): void {
  // Logging must never break a request (BigInt, odd getters...) — fall back to a minimal line.
  let line: string
  try {
    // Fixed keys last, so a field named "level"/"msg"/"time" cannot overwrite them.
    line = JSON.stringify({ ...(redact(fields) as LogFields), level, msg: scrubString(msg), time: new Date().toISOString() })
  } catch {
    line = JSON.stringify({ level, msg: scrubString(msg), time: new Date().toISOString(), logError: 'unserializable fields' })
  }
  sink(line, level)
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => write('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => write('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => write('error', msg, fields),
}
