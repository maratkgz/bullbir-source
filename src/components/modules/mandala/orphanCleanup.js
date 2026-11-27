// One-time cleanup of items left over from tables deleted before deleting cascaded:
// tasks/habits whose mandalaRef points to a table that no longer exists, and weekly reviews
// of such tables. Reads from the SERVER only (never the offline cache), so a partially cached
// list can't make a live table look deleted.
import { collection, deleteDoc, doc, getDocsFromServer } from 'firebase/firestore'

const LINKED_COLLECTIONS = ['tasks', 'habits', 'weeklyReviews']

const linkOf = (item) => item?.mandalaRef?.id || item?.mandalaId || null

/** Items that point to a mandala id which is not in `existingIds`. Items without a link are kept. */
export function findOrphans(items, existingIds) {
  const alive = new Set(existingIds)
  return (items || []).filter((item) => {
    const link = linkOf(item)
    return !!link && !alive.has(link)
  })
}

/**
 * @returns {Promise<number>} how many leftovers were deleted. Throws when offline (caller retries later).
 */
export async function cleanupOrphans(db, uid) {
  const base = `users/${uid}`
  const mandalas = await getDocsFromServer(collection(db, `${base}/mandalas`))
  const ids = mandalas.docs.map((d) => d.id)
  let removed = 0
  for (const name of LINKED_COLLECTIONS) {
    const snap = await getDocsFromServer(collection(db, `${base}/${name}`))
    const orphans = findOrphans(snap.docs.map((d) => ({ id: d.id, ...d.data() })), ids)
    await Promise.all(orphans.map((o) => deleteDoc(doc(db, `${base}/${name}/${o.id}`))))
    removed += orphans.length
  }
  return removed
}
