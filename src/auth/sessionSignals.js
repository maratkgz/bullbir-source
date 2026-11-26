// Client-only session signals. Nothing secret is stored here: the session itself is the httpOnly
// cookie. A boolean "was signed in" hint decides what to show while /me can't be reached
// (offline start), and a cross-tab message signs every open tab out together.

const SIGNED_IN_HINT_KEY = 'bb.wasSignedIn'
const SIGNOUT_STORAGE_KEY = 'bb.signOut'
const CHANNEL_NAME = 'bullbir-auth'
const SIGNOUT_MESSAGE = 'signed-out'

export function readSignedInHint() {
  try {
    return localStorage.getItem(SIGNED_IN_HINT_KEY) === '1'
  } catch {
    return false
  }
}

/** @param {boolean} signedIn */
export function writeSignedInHint(signedIn) {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, '1')
    else localStorage.removeItem(SIGNED_IN_HINT_KEY)
  } catch {
    // Storage blocked (private mode): an offline start then just shows the login screen.
  }
}

function openChannel() {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

/** Tells the other open tabs that this browser is signed out. */
export function broadcastSignOut() {
  const channel = openChannel()
  if (channel) {
    channel.postMessage(SIGNOUT_MESSAGE)
    channel.close()
    return
  }
  try {
    // The `storage` event fires in the other tabs only; the value just has to change.
    localStorage.setItem(SIGNOUT_STORAGE_KEY, String(Date.now()))
  } catch {
    // No cross-tab channel at all: other tabs find out on their next /me or listener error.
  }
}

/**
 * Calls `onSignOut` when another tab signs this browser out.
 * @param {() => void} onSignOut
 * @returns {() => void} unsubscribe
 */
export function subscribeSignOut(onSignOut) {
  const channel = openChannel()
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data === SIGNOUT_MESSAGE) onSignOut()
    }
    return () => channel.close()
  }
  const onStorage = (e) => {
    if (e.key === SIGNOUT_STORAGE_KEY && e.newValue) onSignOut()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
