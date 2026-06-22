import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// True only when every required key is present.
export const firebaseReady = Object.values(firebaseConfig).every(
  (v) => typeof v === 'string' && v.length > 0,
)

// Placeholder values let the app boot and render the auth screens even with no
// real keys. Network calls are gated behind `firebaseReady` everywhere else.
const fallbackConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo-bullbir',
  storageBucket: 'demo-bullbir.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
}

if (!firebaseReady) {
  // eslint-disable-next-line no-console
  console.warn(
    '[BullBir] Firebase is not configured. Copy .env.local.example to .env.local and add your VITE_FIREBASE_* keys.',
  )
}

export const app = initializeApp(firebaseReady ? firebaseConfig : fallbackConfig)
export const auth = getAuth(app)

// Firestore with offline persistence enabled.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
