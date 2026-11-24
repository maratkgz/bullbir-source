import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'

const MAX_IMPORT_BYTES = 512 * 1024

/** Downloads `data` as a pretty-printed JSON file (for moving admin edits into the repo). */
export function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

/** Reads a user-picked JSON file; rejects big or malformed files. */
export async function readJsonFile(file) {
  if (!file) throw new Error('No file')
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large')
  const text = await file.text()
  return JSON.parse(text)
}

/** Strips runtime-only fields before saving or exporting. */
export function cleanEntry(entry) {
  const { source: _s, updatedAt: _u, ...rest } = entry
  return rest
}

export async function saveEntry(collectionName, entry) {
  await setDoc(doc(db, collectionName, entry.id), { ...cleanEntry(entry), updatedAt: serverTimestamp() })
}

/** Hides a built-in entry for everyone (stored as { id, disabled: true }). */
export async function disableEntry(collectionName, id) {
  await setDoc(doc(db, collectionName, id), { id, disabled: true, updatedAt: serverTimestamp() })
}

/** Removes the Firestore entry → custom item disappears, built-in item is restored. */
export async function removeEntry(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id))
}
