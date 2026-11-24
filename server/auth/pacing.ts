// Response-time padding for endpoints whose work differs by whether an address is registered
// (send a code vs. send a notice vs. do nothing). Padding every answer to the same floor hides
// that difference from a stopwatch.
let minResponseMs = 1000

export function setMinResponseMsForTests(ms: number | undefined): void {
  minResponseMs = ms ?? 1000
}

/** Runs `work`, then waits until at least the floor has passed — also when `work` throws. */
export async function withMinDuration<T>(work: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const pad = async () => {
    const left = minResponseMs - (Date.now() - started)
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
