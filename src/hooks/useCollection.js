import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useToast } from '../components/ui/Toast'
import { reportDataError, reportingWrite } from '../monitoring/reportError'

// Real-time CRUD for users/{uid}/{name}
export function useCollection(name, { orderField = 'createdAt', direction = 'desc' } = {}) {
  const { user, recoverBridge, bridgeEpoch } = useAuth()
  const toast = useToast()
  const { t } = useLang()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  // Last listener error (Firestore error with `.code`), null while the listener is healthy.
  const [error, setError] = useState(null)

  const path = user ? `users/${user.uid}/${name}` : null
  const pathRef = useRef(path)

  // The toast API object is recreated on every toast change; keep write callbacks stable.
  const notifyRef = useRef(null)
  notifyRef.current = () => toast.error(t('common.saveFailed'))

  const inBackground = useCallback(
    (op, write) => {
      reportingWrite(op, name, write).catch(() => notifyRef.current?.())
    },
    [name],
  )

  useEffect(() => {
    // New path (or none): never show the previous user's / collection's items. A re-subscribe
    // on the same path (new bridge token) keeps them to avoid a flash of empty content.
    if (pathRef.current !== path) {
      pathRef.current = path
      setItems([])
    }
    setError(null)
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
        setError(null)
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        setError(err)
        reportDataError('listen', name, err)
        // Bridge token outdated (credentials changed elsewhere): re-mint it; bridgeEpoch then
        // changes and this effect re-subscribes. Recovery is deduped and capped in AuthContext.
        if (err?.code === 'permission-denied') recoverBridge?.(bridgeEpoch)
      },
    )
    return unsub
  }, [path, name, orderField, direction, bridgeEpoch, recoverBridge])

  const add = useCallback(
    async (data) => {
      if (!path) return null
      // The id is generated locally, so the item appears at once (Firestore latency
      // compensation) and the caller does not wait for the server — no slow dialogs, no
      // duplicate items from repeated taps. A later server rejection is reported + toasted.
      const ref = doc(collection(db, path))
      inBackground('add', () => setDoc(ref, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }))
      return ref.id
    },
    [path, name, inBackground],
  )

  const update = useCallback(
    async (id, data) => {
      if (!path) return
      inBackground('update', () => updateDoc(doc(db, path, id), { ...data, updatedAt: serverTimestamp() }))
    },
    [path, inBackground],
  )

  const remove = useCallback(
    async (id) => {
      if (!path) return
      inBackground('remove', () => deleteDoc(doc(db, path, id)))
    },
    [path, inBackground],
  )

  return useMemo(
    () => ({ items, loading, error, add, update, remove }),
    [items, loading, error, add, update, remove],
  )
}
