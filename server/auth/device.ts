// A short, human label for "my devices" ("Chrome · Windows"). Deliberately coarse: we keep no
// full User-Agent string (it is a fingerprinting aid and not needed).
import type { IncomingMessage } from 'node:http'
import { header } from '../http.js'

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/YaBrowser/, 'Yandex'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

function first(list: ReadonlyArray<[RegExp, string]>, ua: string): string | undefined {
  return list.find(([re]) => re.test(ua))?.[1]
}

export function deviceLabel(req: IncomingMessage): string {
  const ua = (header(req, 'user-agent') ?? '').slice(0, 512)
  const parts = [first(BROWSERS, ua), first(SYSTEMS, ua)].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Unknown device'
}
