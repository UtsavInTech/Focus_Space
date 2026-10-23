# Relevance ranking & subscription intelligence

FocusSpace answers "among the channels I already follow, what is genuinely useful for what I'm learning?" with a deterministic, explainable scoring system in `src/learning/relevance/`. A keyword appearing in a title is **evidence**, not a verdict.

```
video title + description
      │
      ├─ topic evidence   (mode + topic keywords, by specificity, deduplicated)
      ├─ learning signal  (tutorial, lecture, explained, "L6.", "Leetcode 1590"…)
      ├─ noise penalties  (hype, news, lifestyle, entertainment, promo, podcast…)
      │
      ▼
 base score 0–1 ──► channel profiles ──► final score ──► tier ──► threshold ──► rank
```

## Why v1 was too permissive

Measured on real feeds from 18 channels (`src/learning/relevance/__fixtures__/real-channels.json`), v1 showed **105 of 270** videos as relevant in AI / ML. Four things went wrong:

- **Broad words qualified on their own.** `ai` was worth 2 points, enough to pass, so "My New Laptop for AI" counted.
- **Overlapping terms were counted twice.** `llm` + `llms`, `neural network` + `neural networks`, and so on.
- **Channel description boilerplate matched everywhere.** A channel repeating "neural networks" in every description made all of its videos match.
- **Recency was 35% of the ranking.** Weak new uploads outranked strong older lessons.

## Scoring model (`scorer.ts`)

All components are 0–1:

| Component | Meaning |
| --- | --- |
| **T** | Title topic evidence: a noisy-OR of distinct, non-overlapping matches. Phrase weight 0.9 (topic name 0.95), specific word 0.6–0.75, acronym 0.7, broad or `~supporting` 0.25–0.45. If only broad terms match, T is capped at 0.3. |
| **D** | Description evidence: specific terms only, after removing links, promo lines, hashtags and lines the channel repeats (boilerplate). |
| **TE** | Topical evidence, `1 − (1 − T)(1 − 0.55·D)`. |
| **E** | Exact topic phrase in the title (1), specific word (0.5). |
| **L** | Learning signal, from `lexicon.ts`. Only counts in proportion to topic evidence. |
| **P** | Noise penalties per category, capped at 0.45. A strongly educational, on-topic title softens podcast/news/story penalties. Penalties for phrases the mode itself asks for (e.g. a "news" mode) are disabled. |

```
base  = 0.62·TE + 0.10·E + 0.28·L·min(1, TE/0.6) − P
final = base + 0.10·channelScore   (only when TE ≥ 0.3)
rules = allowed channel → at least 0.62; blocked channel/keyword → 0
```

A topic phrase alone lands in **Relevant**. A phrase plus a teaching cue lands in **Strong** or **Excellent**.

Other mechanics:

- **Matching** (`matcher.ts`):
  - Token prefiltering keeps it cheap.
  - Every match keeps its span, so overlapping terms ("binary search" inside "binary search tree") and repeats ("machine learning machine learning") count once.
  - Ambiguity guards: "full stack" is not the stack data structure, and "Graph RAG" is not a graph algorithm.

### Tiers

| Tier | Score | Where it appears |
| --- | --- | --- |
| Excellent match | ≥ 0.90 | Main feed |
| Strong match | ≥ 0.75 | Main feed |
| Relevant | ≥ 0.60 | Main feed (`FEED_MIN_SCORE`) |
| Weak match | ≥ 0.45 | Hidden behind "Show weaker matches" |
| Not relevant | < 0.45 | Never shown |

The UI shows tier labels, never percentages. Numeric scores only appear in the developer view.

## Off-domain guard (`domains.ts`)

Some videos belong to another world entirely, whatever words they share with a Space. Competitive-exam
prep is the loudest case: "SSC CGL Computer Awareness: Operating System" is not System Design, and an
account that once watched SSC videos gets them in every YouTube search and recommendation.

- Exam families (UPSC, SSC, banking, railways, state PSC, defence/police, teaching, JEE, NEET, school
  boards, plus the shared government-exam vocabulary) are recognised in the **title**, the **channel
  name** (including exam-only brands such as Adda247), and a **description** that names two or more.
- A family the Space itself names in its configuration is its own and is never penalised.
- Penalty, outside the 0.45 noise cap: 0.6 for government-exam prep in any other Space, 0.35 for school
  and entrance prep (a Maths Space may want a JEE lecture), 0.25 for a sibling exam (SSC in a UPSC Space).
- GATE is deliberately absent: it is the CS learner's own exam.

Discovery adds one rule on top (`hasOwnEvidence` in `discovery.ts`): a YouTube recommendation must name
the subject in its **title**, and a result of the Space's own search must, in a learning Space, have title
or description evidence. The search alone is context, not evidence. Nothing off-domain is ever discovered.

## Space kinds and search context (V3)

A space's `kind` changes what counts as a positive cue:

| Kind | Cue lexicon | Noise that is *not* penalised |
| --- | --- | --- |
| `learning` | tutorial, lecture, explained, "L18.", "Leetcode 1590"… | — |
| `media` | official music video, audio, album, live performance, jukebox… | podcast/live, news ("new release") |
| `general` | learning lexicon | — |

**Search context (Q).** A video found by the space's *own* YouTube search counts as topic evidence: `TE = 1 − (1 − T)(1 − 0.55·D)(1 − Q)` with Q = 0.35 (learning), 0.55 (general), 0.75 (media). Music titles often never name the genre ("Karan Aujla – Wavy (Official Music Video)"), so a Punjabi music space trusts its own "punjabi songs" search, but the same video arriving through generic recommendations is not shown. Noise penalties still apply, so "Reacting to …" stays out.

Generic media cues are never used as topic keywords, or every music video on YouTube would match a music space.

## Ranking (`library.ts`)

1. Tier, then score in 0.02 steps.
2. Exact topic phrase.
3. Learning signal.
4. Channel relevance.
5. Recency.

Recency is last on purpose: the goal is the best learning content, not the newest.

Supporting behaviour:

- **No padding.** If six videos clear the threshold, the feed shows six and says so.
- **News is kept separate.** On-topic news and announcements go to an "In the news" section instead of the learning feed.
- **Topic view** (`filterLibrary`): only videos with real evidence for that topic (topic score ≥ 0.5), ranked by `0.6·topic fit + 0.4·relevance`.
- **Search** (`searchLibrary`): `0.45·text match + 0.40·relevance + 0.15·topic agreement`. The query itself is classified, so "transformers" also finds attention and BERT lessons.
- **YouTube search** (`searchQueryWithContext`) appends the mode's search context unless the query already names a topic phrase. "transformers" becomes "transformers machine learning", while "attention mechanism" is left as is.

## Channel relevance (`channels.ts`)

A channel's score for a mode comes from its recent videos, never its name:

```
score = confidence(sample size) × ( 0.40·share relevant
                                  + 0.20·mean relevance
                                  + 0.15·educational consistency
                                  + 0.10·topic coverage
                                  + 0.15·topical share )
```

Each channel also gets a mode-relative kind. The Subscriptions page and ranking follow this order:

1. **Education**: channels that consistently teach the mode.
2. **Often covers**: relevant technology and engineering channels.
3. **News**: on topic, mostly announcements.
4. **Occasionally covers**: a relevant video now and then.
5. **General / entertainment / not enough data**.

The same channel can be "education" for AI / ML and "general" for DSA.

## Configuring modes

- Topic names and multi-word phrases are the strongest signals.
- Broad words (`ai`, `data`, `code`, `algorithm`…) are recognised automatically and only support other evidence.
- Prefix a keyword with `~` to mark it as supporting, e.g. `~probability` in AI / ML.
- *Mode editor → Test your rules* shows the full signal breakdown for any title, including unsaved edits.
- Built-in modes the user never edited automatically follow improved templates.

## Caching

- Channel-independent results are cached in memory per mode id + mode fingerprint (a hash of topics, keywords and `CLASSIFIER_VERSION`), then per video id with a content signature.
- `src/background/relevance-warmer.ts` persists snapshots for the active and default modes in `chrome.storage.local` (`relevanceCache`), so pages don't classify thousands of videos on load.
- Editing a mode or bumping `CLASSIFIER_VERSION` invalidates exactly the affected results.

## Debugging

*Settings → Show relevance details* does three things:

- Adds a "Why 0.82?" breakdown to every video card.
- Shows channel profile metrics on the Subscriptions page.
- Writes `data-fs-score` attributes on YouTube search results and suggestions.

```
Transformers Explained From Scratch      0.80 · Strong match
  title: "transformer" — word · LLMs & Transformers    +0.75
  topic evidence 0.75 × 0.62                          +0.465
  specific topic word in title                        +0.05
  learning: explained, from scratch                   +0.28

My New Laptop for AI                     0.00 · Not relevant
  title: "ai" — broad · mode signal                   +0.25
  only broad terms in title → topic evidence capped at 0.3
  no educational signal in title
  lifestyle: "my new"                                 −0.25
```

## Tests

`src/learning/relevance/relevance.test.ts` covers:

- The reported AI / ML examples (excellent ≫ career talk > accidental matches).
- Deduplication, guards, penalties, supporting keywords and boilerplate.
- Every built-in mode.
- The threshold, sorting, topic view and search.
- The A–E channel ordering emerging from scores alone.
- Cache invalidation.
- Assertions against the frozen real-channel fixture for AI / ML and DSA.

## Future: rules + scoring + AI

An AI classifier would **augment** this system, not replace it (see `AI_ARCHITECTURE.md`). The rules still provide a fast, offline, explainable baseline; AI refines borderline scores and subtopics, and every result keeps the same `Classification` shape and cache.
