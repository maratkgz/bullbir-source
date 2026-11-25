import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// Real-time single document at users/{uid}/{name}/{id}
export function useDoc(name, id) {
  const { user, recoverBridge, bridgeEpoch } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const path = user && id ? `users/${user.uid}/${name}/${id}` : null

  useEffect(() => {
    if (!firebaseReady || !path) {
      setLoading(false)
      setData(null)
      return undefined
    }
    setLoading(true)
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => {
        setData(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        if (err?.code === 'permission-denied') recoverBridge?.()
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

  return { data, loading, save }
}
