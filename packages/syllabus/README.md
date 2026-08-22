# @ai-tutor/syllabus

The curriculum as **data**. Class → Subject → Chapter → Topic, NCERT-aligned. The
lesson designer (tools/design-lesson) consumes one Topic node and produces one
lesson. Adding syllabus coverage means adding JSON under `data/`, never code.

## Public API

```ts
interface Topic {
  id: string
  title: string
  objectives: string[]        // "student can explain why..." — drives the LLM designer
  prerequisites?: string[]    // topic paths
  visualIdeas?: string[]      // hints for the designer's canvas plan
  estMinutes?: number
}
interface Chapter { id: string; title: string; topics: Topic[] }
interface SubjectSyllabus {
  id: string                  // e.g. "class10-science"
  klass: number               // 6..12  ("class" is reserved)
  subject: string
  chapters: Chapter[]
}

loadSyllabus(json: unknown): SubjectSyllabus          // validates, throws on malformed
getTopic(s: SubjectSyllabus, path: string): Topic | null
  // path = "<syllabusId>/<chapterId>/<topicId>", e.g.
  // "class10-science/life-processes/heart-circulation"
listTopics(s: SubjectSyllabus): { path: string; topic: Topic }[]
```

## Data

`data/class10-science.json` — seed: Class 10 Science, Life Processes chapter
(nutrition, respiration, transportation/heart, excretion), objectives per topic.

## Depends on

Nothing.
