// Response-time padding for endpoints whose work differs by whether an address is registered
// (send a code vs. send a notice vs. do nothing). Padding every answer to the same floor hides
// that difference from a stopwatch.
let minResponseMs = 1000

export function setMinResponseMsForTests(ms: number | undefined): void {
  minResponseMs = ms ?? 1000
}

/**
 * Runs `work`, then waits until at least the floor has passed — also when `work` throws.
 * `floorMs` lowers the floor for latency-sensitive endpoints (tests can force 0 for all).
 */
export async function withMinDuration<T>(work: () => Promise<T>, floorMs?: number): Promise<T> {
  const started = Date.now()
  const floor = Math.min(floorMs ?? minResponseMs, minResponseMs)
  const pad = async () => {
    const left = floor - (Date.now() - started)
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
  }
  try {
    const result = await work()
    await pad()
    return result
  } catch (err) {
    await pad()
    throw err
  }
}
