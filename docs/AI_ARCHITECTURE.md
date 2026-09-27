# AI architecture

- **Relevance and intent** are rule-based and local, and every judgement is explainable ([RELEVANCE.md](RELEVANCE.md)).
- **V4 adds an AI learning companion** on the watch page. It runs only when the learner clicks, and it receives only the context of the current moment.
- **There are no API keys in the extension.**

## Seams

| Seam | File | Today | Later |
| --- | --- | --- | --- |
| `VideoClassifier` | `src/learning/classifier.ts`, `src/ai/registry.ts` | Rules classifier | AI classifier that augments the rules |
| `IntentEngine` | `src/modes/intent.ts` | Catalogue + composed intents | AI intent → topics and signals |
| `Sidekick.assess()` | `src/ai/sidekick.ts` | Deterministic on-track verdict | LLM rationale |
| **AI actions** | `src/learning/ai/actions.ts` | What am I learning? · Explain · Example · Quiz me (questions go to chat) | Summaries, notes, flashcards, interview/coding questions, simplify, compare: one entry + one task line each |
| **AI providers** | `src/learning/ai/service.ts`, `src/background/ai.ts` | The hosted FocusSpace API (`server/`, metered per account and per install); Chrome's on-device model; a self-hosted endpoint for development | — |
| **Learning context** | `src/learning/context/context.ts` | Moment, concept outline, course position, space topic path | Learning-plan queries ("what am I missing before trees?") |
| **Knowledge sources** | `src/learning/knowledge/types.ts` | chapters, description, comments, transcript | `'ai'` source for concept labelling/refinement (base confidence 0.5) |

## Flow

```
video.currentTime ──► locateConcept (local, every timeupdate)  ──► "You're learning: Insertion"
                                                                    (no network, no AI)

learner clicks "Explain" ─► transcript? (else the player loads captions, restored after)
                          ─► buildLearningContext(moment)          ← only this moment
                          ─► runtime message 'ai/run' ─► service worker
                          ─► cache by (action, video, concept, ~20 s window, question)
                          ─► provider: endpoint | Chrome on-device
                          ─► answer shown inline, labelled "AI can make mistakes"
```

- **Nothing on playback.** Nothing in the playback path calls the service. `ai.test.ts` simulates an hour of `timeupdate` and asserts zero provider calls, and the E2E suite asserts no endpoint requests while the video plays.
- **"What am I learning?"** is answered locally from the map and the path (`describeMoment`). AI only adds to it when a provider is ready.
- **No provider.** "Explain", "Example" and "Quiz me" say so honestly and show what the instructor said around that moment, from the transcript, instead of an answer.

## The context object

```jsonc
{
  "version": 1,
  "videoId": "oAja8-Ulz6o",
  "videoTitle": "Introduction to Linked List | Data Structures & Algorithms | Java Placement Course",
  "channel": "Apna College",
  "mode": { "id": "dsa", "name": "DSA", "kind": "learning" },
  "learningPath": { "topics": ["Arrays", "Strings", "Linked Lists", "…"], "currentTopic": "Linked Lists" },
  "playlist": { "id": "PLfq…", "title": "Java Placement Course", "source": "creator-playlist", "position": 18, "total": 31, "next": "…", "nextLabel": "Next in this playlist" },
  "currentTime": 1100,
  "timestamp": "18:20",
  "currentConcept": "Insert in a Linked List (First & Last)",
  "conceptPath": ["Insert in a Linked List (First & Last)"],
  "conceptId": "980-insert-in-a-linked-list-first-last",
  "conceptSource": "description",
  "previousConcepts": [],
  "upcomingConcepts": ["Display/Print a Linked List", "Delete in a Linked List (First & Last)", "Size of a Linked List"],
  "transcriptWindow": { "startSec": 1010, "endSec": 1122, "text": "…what the instructor just said…" }
}
```

The transcript window:

- covers about 90 s before the moment and 20 s after
- never reaches much further back than the start of the current concept
- is capped at 2,400 characters, keeping what was said closest to the moment

A 3-hour transcript still produces a prompt under 4,000 characters (tested).

## Chat: passages from elsewhere in the video

The moment window answers "what is he saying now?", and the whole-video outline answers "where is X taught?". Neither answers "what did he say about collisions?" asked an hour later — the outline names topics, not what was said. For that, chat searches the full transcript **locally** (`src/learning/knowledge/passages.ts`) and adds only what it finds.

```
learner sends a chat message ─► ChatPanel: buildLearningContext({ …, question })
                              ─► findRelatedPassages(transcript, question)   ← in the browser, no network
                                   passages of ~45–60 s, BM25 over stemmed words,
                                   + exact phrases ("binary search"), + the outline section / map node the question names,
                                   nearness to the playhead only as a tie-breaker
                              ─► context.relatedPassages: ≤ 3 excerpts, ≤ 1,800 characters, each with its time
                              ─► chat prompt block "[From elsewhere in this video]" ─► same provider path as before
```

- **Built on first question, never on playback.** The passage index is made the first time a question is asked on a video and kept in memory for that transcript (a `WeakMap` keyed by the segments array). Nothing is persisted.
- **Bounded by design.** A 12-hour transcript is ~1,000 passages to search; the prompt still carries at most three short excerpts. Prompt size does not grow with video length (tested).
- **Nothing forced in.** A greeting, a general question, or a term the video never uses returns no passages, and chat behaves exactly as before. A passage mostly inside the moment window is skipped — it is already in the prompt.
- **Chat only.** Explain, Example, Quiz me, notes and mind maps never pass a question into the context, so they never get passages.
- **Long videos get a finer outline.** Past three hours the outline is made in ~1-hour parts (`outlineParts`), a few requests at a time, then merged — up to 200 topics instead of 40. A section far longer than the rest (≥ 20 min and 4× the median) is a stretch the model skipped, and is outlined once more on its own (`longGaps`, `spliceGap`). In a part past the first hour the model is asked for `h:mm:ss`, and an hourless time that lands outside its part is re-read with the part's hour (`parseOutline` with `part`) — on a real 5h22m course two whole parts came back as "9:25"-style times. Up to three hours the upload, prompt and parsing are unchanged, so stored outlines still match.
- **Cited times are links.** The chat prompt asks for `[mm:ss]` / `[mm:ss–mm:ss]`, only from times given in the context; `RichText` with `onSeek` turns them into buttons that use the Knowledge Map's seek (`src/content/data/knowledge.ts`). Everywhere else they stay text.

## Quiz quality

"Quiz me" tests whether the learner understands the subject, not whether they remember how the YouTube course is organised.

- **Context split.** The prompt separates *orientation* (course, position, section names, previous/upcoming concepts) from *what is being taught now* (current concept and transcript). The system prompt says orientation is never subject matter.
- **Quiz rules.** Questions should be useful in an exam or interview:
  - Test concepts, differences between similar ideas, syntax, reading code and predicting its output, edge cases, and applying the idea.
  - At least one question must require reasoning, not just recall.
  - Every question is grounded in the transcript and the current concept.
  - Difficulty follows the material.
  - Never ask about chapter or lecture numbers, levels, what comes next, the order topics are presented in, or what the instructor said. The exception is when an ordering is itself the concept being taught, e.g. SQL execution order.
- **More material.** Quizzes see up to 7 minutes and 4,500 characters of transcript, starting at least 2.5 minutes back, so a concept that just started still gets real material (`WINDOW_FOR` in `learning/ai/actions.ts`).
- **Safety net.** `reviewQuiz()` scans the questions for course or video metadata:
  - "the next chapter", "intermediate level", "according to the instructor / Baraa", "mentioned after".
  - It stays narrow on purpose: "the math module", "Taylor series" and "isolation level" are subject matter and pass.
- **One revision.** When a question is flagged, the service asks the provider once to replace it and keeps the revised quiz. A good first draft costs a single request. Tests use the exact metadata quiz learners saw on the SQL course.

## Providers and security

```
Extension (no secrets)
  ├─ HTTPS ─► FocusSpace API (server/, holds the one OpenAI key, meters usage) ─► OpenAI
  ├─ Chrome on-device model (Prompt API, Chrome 138+) — nothing leaves the browser
  └─ HTTP ─► a self-hosted endpoint, for development only (scripts/ai-endpoint)
```

A store build has the API's address baked in (`VITE_API_URL`, `src/config.ts`), so learners never
configure an endpoint or supply a key. The contract below is what that API and the development
endpoint both speak.

- **Automatic** (the default) uses the endpoint when one is configured, otherwise the on-device model when Chrome reports it `available`. The one-time model download starts only from a click in Settings.
- **Endpoint contract:** `POST <url>`

  ```json
  { "version": 1, "action": "chat", "question": "Why is prev required here?", "context": { "…": "LearningContext" }, "prompt": { "system": "…", "user": "…" } }
  ```

  The endpoint returns `{ "answer": "…" }`. It must allow cross-origin POSTs (CORS), so no extra extension permissions are needed.
- **Reference server:** `scripts/ai-endpoint/server.mjs`. It keeps `OPENAI_API_KEY` in its environment, forwards `prompt` to OpenAI (`OPENAI_MODEL`, default `gpt-4o-mini`), and limits request size.
- **Rendering:** answers are plain text; code blocks go in `<pre>`. Nothing is rendered as HTML or executed.

## Data sent to the AI

- **Sent with an AI action or chat message:**
  - video title and channel
  - timestamp
  - current, previous and upcoming concept titles
  - course title and position
  - the space's name and topic names
  - the transcript window
  - the question
  - chat only: up to three passages from elsewhere in the same video that match the question (≤ 1,800 characters), picked in the browser
- **Sent to make an outline** (`POST /v1/outline`, only when no stored outline matches): the video's captions, condensed for long videos (`condenseTranscript`). The API stores only the outline and a hash of those captions.
- **Never sent:** watch history, subscriptions, other videos, comments. No AI action or chat message carries the full transcript.

## Next steps

- **Learning plan.** `LearningContext.learningPath` already carries the space's topic order. A plan engine can map the learner's watched concepts to those topics and answer "Am I missing anything before trees?" through a new action.
- **AI refinement of maps.** For transcript-only maps, one request per video, cached as a Knowledge Map source `'ai'`, never replacing chapters.
- **More actions:** flashcards, interview question, coding exercise. (Notes, mind maps and chat are built — see [V5_CONTRACT.md](V5_CONTRACT.md).)
