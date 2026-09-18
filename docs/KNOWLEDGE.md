# Learning path and Video Knowledge Map (V4)

FocusSpace understands:

- where the learner is in a course,
- what comes next,
- what the current video teaches, and
- which concept is on screen right now.

It builds this from real evidence only: YouTube's own data plus what the learner has actually watched.

```
watch data (next) ─┬─ playlist in URL ─────────────┐
                   ├─ playlists linked in description ┤──► learning path  (learning/path)
                   ├─ numbered uploads (guess) ─────┘
                   │
                   ├─ chapters ─────────────┐
                   ├─ description ──────────┤
comments (≤2 pages)┤                        ├──► Knowledge Map ──► current concept ──► context ──► AI (on request)
captions (player) ─┘                        │    (learning/knowledge)  (locate, local)    (learning/context, learning/ai)
                         space vocabulary ──┘
```

YouTube-specific extraction lives in `src/integrations/youtube` (`knowledge-parse.ts`, `transcript-parse.ts`). The learning layer (`src/learning/path`, `knowledge`, `context`, `ai`) only sees neutral types.

## Learning path

`content/data/series.ts → learningPathFor()` picks the most authoritative sequence it can find:

| Source | When | Shown as |
| --- | --- | --- |
| `playlist` | The learner is watching through a playlist (`list=` in the URL). | "Your course · This playlist" · "Next in this playlist" |
| `creator-playlist` | The description links a playlist that contains this video and is mostly the same channel's uploads (checked, not assumed). | "Your course · Creator's playlist" · "Next in this playlist" |
| `series` | Numbered titles in the channel's uploads ("L18.", "Lecture 18", "4.7"). | "Continue this series" · "Next in this series" or "Appears to be next" |

`learning/path/path.ts → buildLearningPath()` reuses the V3 series state (`learning/next.ts`) and adds the following:

- **Next means the next unfinished item.** If lectures 19 and 20 are complete, "next" after 18 is 21, labelled "Next unwatched".
- **Watched requires progress.** A video counts as watched only at ≥ 85 % progress, whether measured by FocusSpace or reported by YouTube for a signed-in user. Opening a video never counts.
- **Skipped needs evidence.** An earlier item is skipped only when later items were completed. Starting mid-course is not skipping.
- **Row states:** watched, in progress (with %), current ("You are here"), next, skipped, unwatched. The window stays short and says how many items it hides.
- **Relevance scoring never reorders a course.** Related videos are grouped after it: more from this creator → your subscriptions → best from YouTube → more related.

## Knowledge Map

### Evidence and confidence

| Source | Base confidence | Notes |
| --- | --- | --- |
| Creator chapters | 0.98 | `markersMap` `DESCRIPTION_CHAPTERS`; engagement-panel fallback. |
| YouTube auto chapters | 0.90 | Only when the creator made none. |
| Description timestamps | 0.90 (0.78 if short or unordered) | Also when YouTube didn't turn them into chapters (e.g. the list doesn't start at 0:00). Ignored when identical to the chapters, so the same list isn't counted twice. |
| Transcript transition | 0.90 cue + strong shift · 0.75 cue · 0.70 vocabulary · 0.58 terms | See segmentation. |
| Comments, several agreeing | 0.76–0.85 | Distinct comments within ±1 % of the duration (15–60 s) with similar labels. |
| Comments, single outline or moment | 0.60–0.68 | Likes add up to +0.06. A pinned or creator comment counts 0.85. |
| Conflict penalty | −0.07 | Same label, times too far apart to agree but too close to be a separate occurrence. |
| Concept mentioned without a time | 0.55 | Placed where the transcript first discusses it, otherwise kept as a mention. |

- **Confidence is internal.** It ranks and filters evidence (items below 0.5 are hidden) and appears only in the developer view (*Settings → Show relevance details*).
- **Learners see the source,** e.g. "From the description", or "From viewer comments · may be inaccurate".

### Comment intelligence (`knowledge/comments.ts`)

Each comment is read before anything is trusted:

- **outline:** at least 3 ascending, timestamped topic lines. Headers such as "SESSION 2: Time Complexity" become groups; "(Start time: 01:57:44)" places a header; clip lengths like "(4:37)" are removed.
- **moment:** "At 31:20 he starts explaining recursion", or "17:30 insertion starts".
- **summary:** "Today he covered linked list insertion, deletion and reversal." These become mentions only.
- **noise:**
  - progress logs ("day 1) 00:00 - 36:33", "Feb 7 2:09:50")
  - requests ("Sir please make a video on trees")
  - reactions ("love his expression 11:32")
  - discussions and bug reports pinned to a timestamp
  - promotion

Remaining candidates are clustered by time and label similarity:

- **Agreement:** independent agreement raises confidence.
- **Conflicts:** go to the majority, with a penalty.
- **Repeats:** a topic repeated far apart stays as separate occurrences.

Comments are only fetched (top comments, at most 2 pages, after the player settles) when the space isn't a media space and the chapters don't already give a detailed outline: no chapters, or at most 4 chapters on a video of 40 minutes or more.

### Transcript (`knowledge/segment.ts`, bridge)

- **Why the bridge.** Direct transcript requests (`get_transcript`, or a caption URL without the player's token) are rejected or return empty. So the main-world bridge reads the `/api/timedtext` responses YouTube's player itself loads: cloned, never modified.
- **When captions load.** If the player hasn't loaded captions and the learner asks for something that needs them ("Explain", "Read the transcript"), the bridge has the player load the best track (uploaded before auto-generated). It hides the caption window meanwhile, then restores the caption on/off state and YouTube's `yt-player-caption-persistence` preference. It never happens on its own.
- **Segmentation** is TextTiling-style, with:
  - lexical cohesion between neighbouring 20–45 s blocks
  - depth scores
  - spoken cues ("now let's talk about…", plus common Hindi–English cues)
  - a minimum gap
  - roughly one section per 6 minutes at most
- **Labels** prefer the spoken cue ("efficiency of binary search"), then the space's own vocabulary, then distinctive terms. Fragments like "you i'm thinking of a" are rejected.
- **Accuracy.** On a real 75-minute freeCodeCamp lecture, over 60 % of detected boundaries fall within 60 s of the topic starts a viewer wrote independently (tested).
- **Corroboration.** The transcript also backs up comment items: a topic shift or matching words at that moment adds up to +0.06.

### Fusion and hierarchy (`knowledge/fuse.ts`)

1. **Backbone:** the first source with at least 2 items, in the order chapters → description → comments → transcript.
2. **Merge the other sources**, each as its own tree:
   - an item matching an existing node (close in time and similar label) corroborates it
   - otherwise it goes inside the backbone node containing it: groups directly under the top-level node, single items into the deepest existing group
   - transcript sections are only inserted into long, empty backbone items
   - nothing is added before the first backbone item
3. **Group related siblings:** runs of 3 or more sharing a head word become a parent, e.g. "Insertion" › "at beginning" / "at end" / "in middle", never grouped twice under the same word.
4. **Merge duplicates**, and children that repeat their parent.

Example: a real 5-hour course with 3 coarse creator chapters, plus a viewer's session outline and the transcript:

```
Introduction to Algorithms                [chapters 0.98]
  Playing a Counting Game                 [comments +transcript]
    What Is an Algorithm? · Guess the Number · … · Evaluating Binary Search
  Time Complexity › Efficiency · Constant & Logarithmic Time · …
  Algorithms in Code › Linear Search in Code · Binary Search in Code [2 comments agree] · …
Introduction to Data Structures           [chapters + comments]
  Exploring Arrays › …   Building a Linked List › …   Merge Sort & Linked Lists › …
Algorithms: Sorting and Searching         [chapters + comments]
```

Building it takes about 35 ms.

### Current concept (`knowledge/locate.ts`)

- **Lookup:** `conceptStops(map)` flattens the visible nodes once. `locateConcept(stops, t)` is a binary search returning the deepest current concept, its parents, the previous concepts and the upcoming ones.
- **Updates:** `content/data/knowledge.ts → usePlaybackConcept` runs it on `timeupdate`/`seeked`, ignoring ads and a stale `<video>` during SPA navigation. React re-renders only when the concept changes.
- **Cost:** 14,400 lookups (an hour at 4 Hz) take under 100 ms in tests.

### Caching

| What | Where | Key / invalidation |
| --- | --- | --- |
| Knowledge maps | `chrome.storage.local` → `knowledgeMaps` (60 most recent) | `KNOWLEDGE_VERSION` + input signature (chapters, description hash, comment ids, transcript language/kind/length, duration, space vocabulary). A stored map built with more evidence (e.g. a transcript) is kept until equally rich inputs arrive. |
| Comments | in-memory request cache, 30 min | video id |
| Playlists | in-memory request cache, 30 min | playlist id |
| Transcripts | memory, current tab session | re-captured on the next visit |

## Tests

- **`src/learning/path/path.test.ts`:**
  - current, next, and next unwatched (19 and 20 watched → 21)
  - partial progress isn't watched
  - skipped lectures, starting mid-course, window size
  - creator playlist vs. guessed series labels
- **`src/learning/knowledge/knowledge.test.ts`:**
  - extraction from real responses (chapters, description playlist links, comment pages, json3 captions)
  - timestamps and noise
  - description outlines and topic lists
  - every comment type from the spec, agreement, conflicts, real comment classification
  - transcript segmentation against an independent viewer outline
  - fusion for chapters-only, description-only, comments-only, no sources, and the real 5-hour course hierarchy
  - grouping and duplicates, signatures
  - concept boundaries, and lookup cost
- **`src/learning/ai/ai.test.ts`:**
  - context object, local "What am I learning?"
  - transcript window selection and size cap, prompt contents and size
  - AI service: provider called only on request, cache by moment and question, shared in-flight requests, unavailability, and zero AI calls across an hour of simulated playback

Fixtures are trimmed real responses captured on 2026-09-13, in `src/integrations/youtube/__fixtures__/innertube` and `src/learning/knowledge/__fixtures__`.

## Limitations

- **Transcripts depend on captions.** They exist only for videos with captions, and only once YouTube's player has loaded them (automatically for some videos, or on request). Transcripts aren't persisted.
- **Ads delay transcripts.** While an ad plays, the player loads the ad's captions, which are stored under the ad's id and never mixed up with the lesson. A request made during an ad waits for the lesson and retries once.
- **Automated browsers get empty captions.** YouTube serves empty caption files, even to its own player, when `navigator.webdriver` is true. The E2E suite launches Chromium with `--disable-blink-features=AutomationControlled` and a regular Chrome user agent for that reason.
- **Comment and transcript outlines are heuristics.** They're labelled as such, and their confidence is capped below chapter level.
- **Transcript labels without cue phrases can be generic.** An AI refinement step fits here (`KnowledgeSource 'ai'`, base confidence 0.5).
- **Creator-playlist detection has limits.** It needs the playlist link in the description, and only the first ~100 playlist items are checked.
- **Watched state has two sources.** FocusSpace's own progress, plus YouTube's progress when signed in. Videos watched elsewhere while signed out are unknown.
