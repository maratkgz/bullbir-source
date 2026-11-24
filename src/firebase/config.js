import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Local development against the Firebase Emulator Suite (`npm run emulators`). Dev server only —
// a production build can never point at the emulators, and they never touch the real project.
export const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true'

// True only when every required key is present (or the emulators are used).
export const firebaseReady = useEmulators || Object.values(firebaseConfig).every(
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

export const app = initializeApp(firebaseReady && !useEmulators ? firebaseConfig : fallbackConfig)
export const auth = getAuth(app)

// Firestore with offline persistence enabled.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const storage = getStorage(app)

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

export const googleProvider = new GoogleAuthProvider()
