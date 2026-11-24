import { useMemo } from 'react'
import { useCollection } from '../../../hooks/useCollection'
import { normalizeMandala } from '../mandala/mandalaModel'
import { weeklyReview } from '../../../ai/engine/insights'
import { computeRewards } from '../../../ai/engine/rewards'
import { mandalaPace } from '../../../ai/engine/pace'

const EMPTY = []

/**
 * Everything the assistant analyses — in the browser only.
 * Mandalas are always used (the assistant works on them). Tasks, habits and moods are
 * read ONLY when the user opted in. Journal and finances are never read.
 */
export function useAssistantData(consentAllModules) {
  const mandalaCol = useCollection('mandalas')
  const taskCol = useCollection('tasks')
  const habitCol = useCollection('habits')
  const moodCol = useCollection('moods')

  const mandalas = useMemo(() => mandalaCol.items.map(normalizeMandala), [mandalaCol.items])
  const tasks = consentAllModules ? taskCol.items : EMPTY
  const habits = consentAllModules ? habitCol.items : EMPTY
  const moods = consentAllModules ? moodCol.items : EMPTY

  return useMemo(() => {
    const review = weeklyReview({ tasks, habits, moods, mandalas })
    const rewards = computeRewards({ mandalas, tasks, habits })
    const paces = mandalas.map((m) => ({ mandala: m, pace: mandalaPace(m) }))
    return { mandalas, review, rewards, paces, loading: mandalaCol.loading }
  }, [tasks, habits, moods, mandalas, mandalaCol.loading])
}
