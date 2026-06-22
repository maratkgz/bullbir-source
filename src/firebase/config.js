import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCjHfzF_FY3qxWBy2uBaVXc2h5S0ToMBQw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bir-121da.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bir-121da',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'bir-121da.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '634337853404',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:634337853404:web:b16dbfffbb28f21d225919',
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
export const appleProvider = new OAuthProvider('apple.com')
appleProvider.addScope('email')
appleProvider.addScope('name')
