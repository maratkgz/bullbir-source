import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// Real-time CRUD for users/{uid}/{name}
export function useCollection(name, { orderField = 'createdAt', direction = 'desc' } = {}) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const path = user ? `users/${user.uid}/${name}` : null

  useEffect(() => {
    if (!firebaseReady || !path) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const q = query(collection(db, path), orderBy(orderField, direction))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [path, orderField, direction])

  const add = useCallback(
    async (data) => {
      if (!path) return null
      const ref = await addDoc(collection(db, path), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return ref.id
    },
    [path],
  )

  const update = useCallback(
    async (id, data) => {
      if (!path) return
      await updateDoc(doc(db, path, id), { ...data, updatedAt: serverTimestamp() })
    },
    [path],
  )

  const remove = useCallback(
    async (id) => {
      if (!path) return
      await deleteDoc(doc(db, path, id))
    },
    [path],
  )

  return useMemo(
    () => ({ items, loading, add, update, remove }),
    [items, loading, add, update, remove],
  )
}
