import { useQuery } from '@tanstack/react-query'
import type { LibraryTopic } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'all'

export function useTopics(grade: number | undefined, subject: string | undefined) {
  return useQuery({
    queryKey: ['library-topics', grade, subject],
    queryFn: () => api.libraryTopics(grade!, subject!),
    enabled: grade !== undefined && subject !== undefined,
    staleTime: 5 * 60 * 1000,
  })
}

/** Chapters in syllabus order, each with its question count. */
export function chaptersOf(topics: LibraryTopic[]) {
  const out: { chapter: string; questions: number }[] = []
  for (const t of topics) {
    const last = out[out.length - 1]
    if (last?.chapter === t.chapter) last.questions += t.questions
    else out.push({ chapter: t.chapter, questions: t.questions })
  }
  return out
}

type TopicFilterProps = {
  grade: number
  subject: string
  chapter: string | undefined
  outcome: string | undefined
  onChange: (next: { chapter: string | undefined; outcome: string | undefined }) => void
  /** 'filter' offers "All chapters" / "All topics"; 'choose' asks for a topic to file a question under. */
  mode?: 'filter' | 'choose'
}

/**
 * Chapter, then topic, in the order the syllabus teaches them (lms.library_topics).
 * Changing the chapter clears the topic.
 */
export function TopicFilter({ grade, subject, chapter, outcome, onChange, mode = 'filter' }: TopicFilterProps) {
  const topics = useTopics(grade, subject)
  const all = topics.data ?? []
  const chapters = chaptersOf(all)
  const inChapter = all.filter((t) => t.chapter === chapter)
  const count = (n: number) => (mode === 'filter' ? ` (${n})` : '')

  return (
    <>
      <Select
        value={chapter ?? ALL}
        onValueChange={(v) => onChange({ chapter: v === ALL ? undefined : v, outcome: undefined })}
        disabled={topics.isPending}
      >
        <SelectTrigger className='w-64' aria-label='Chapter'>
          <SelectValue placeholder={topics.isPending ? 'Loading chapters…' : 'Chapter'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{mode === 'filter' ? 'All chapters' : 'No chapter'}</SelectItem>
          {chapters.map((c) => (
            <SelectItem key={c.chapter} value={c.chapter}>
              {chapterTitle(c.chapter)}
              {count(c.questions)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={outcome ?? ALL}
        onValueChange={(v) => onChange({ chapter, outcome: v === ALL ? undefined : v })}
        disabled={!chapter}
      >
        <SelectTrigger className='w-72' aria-label='Topic'>
          <SelectValue placeholder='Topic' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{mode === 'filter' ? 'All topics' : 'Whole chapter'}</SelectItem>
          {inChapter.map((t) => (
            <SelectItem key={t.outcomeId} value={t.outcomeId}>
              {t.title}
              {count(t.questions)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
