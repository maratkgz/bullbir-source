// What a mandala created elsewhere in the app: tasks and habits carry `mandalaRef.id`,
// weekly reviews carry `mandalaId`. Used to delete them together with the table.

/** Items of a collection that were created from the given mandala. */
export function linkedToMandala(items, mandalaId) {
  if (!mandalaId) return []
  return (items || []).filter((x) => x?.mandalaRef?.id === mandalaId || x?.mandalaId === mandalaId)
}

/** Counts for the delete confirmation. */
export function linkedCounts({ tasks = [], habits = [], reviews = [] }, mandalaId) {
  return {
    tasks: linkedToMandala(tasks, mandalaId).length,
    habits: linkedToMandala(habits, mandalaId).length,
    reviews: linkedToMandala(reviews, mandalaId).length,
  }
}
