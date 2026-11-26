import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// Real-time single document at users/{uid}/{name}/{id}
export function useDoc(name, id) {
  const { user, recoverBridge, bridgeEpoch } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Last listener error (Firestore error with `.code`), null while the listener is healthy.
  const [error, setError] = useState(null)

  const path = user && id ? `users/${user.uid}/${name}/${id}` : null
  const pathRef = useRef(path)

  useEffect(() => {
    // New path (or none): never show the previous document. A re-subscribe on the same path
    // (new bridge token) keeps it to avoid a flash of empty content.
    if (pathRef.current !== path) {
      pathRef.current = path
      setData(null)
    }
    setError(null)
    if (!firebaseReady || !path) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => {
        setData(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setError(null)
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        setError(err)
        if (err?.code === 'permission-denied') recoverBridge?.(bridgeEpoch)
      },
    )
    return unsub
  }, [path, bridgeEpoch, recoverBridge])

  const save = useCallback(
    async (payload) => {
      if (!path) return
      await setDoc(
        doc(db, path),
        { ...payload, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [path],
  )

  return useMemo(() => ({ data, loading, error, save }), [data, loading, error, save])
}
