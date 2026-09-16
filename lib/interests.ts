/**
 * Board Personalization Phase 2B — the curated Interest taxonomy and the
 * deterministic Dispatch-topic → Interest matching this checkpoint uses
 * as a Board ranking tie-shaping signal (see docs/sql/2026-09-27-
 * topical-interests.sql). Deliberately NOT a Supabase-aware module — no
 * network calls, no RPC — so the taxonomy and matching logic stay pure,
 * synchronous, and trivially unit-testable; lib/profile-interests.ts is
 * the thin DB-backed layer on top of this.
 *
 * NAMING NOTE: the word "Interests" already means something else in this
 * app — profiles.intent (onboarding motivations like "Meaningful
 * friendship"), shown on the public profile under an "Interests" label
 * (app/minds/[userId]/interests-disclosure.tsx). This is a SEPARATE,
 * unrelated concept — deliberately never shown on any public profile —
 * so every user-facing surface for THIS feature says "reading interests"
 * / "what you love reading about," never a bare "Interests" label, to
 * avoid colliding with that existing one.
 */

export type InterestOption = { key: string; label: string }

/**
 * ~22 broad, warm categories covering the major kinds of thoughtful
 * personal writing Tempa is likely to contain — deliberately NOT an
 * ad-tech-style taxonomy with hundreds of narrow categories. Order here
 * is the display order everywhere this taxonomy is rendered.
 */
export const INTEREST_TAXONOMY: InterestOption[] = [
  { key: 'life-reflections', label: 'Life & Reflections' },
  { key: 'family-parenting', label: 'Family & Parenting' },
  { key: 'friendship', label: 'Friendship' },
  { key: 'love-relationships', label: 'Love & Relationships' },
  { key: 'spirituality-faith', label: 'Spirituality & Faith' },
  { key: 'philosophy', label: 'Philosophy' },
  { key: 'psychology', label: 'Psychology & Human Nature' },
  { key: 'books-literature', label: 'Books & Literature' },
  { key: 'writing-poetry', label: 'Writing & Poetry' },
  { key: 'art-creativity', label: 'Art & Creativity' },
  { key: 'music', label: 'Music' },
  { key: 'film-tv', label: 'Film & Television' },
  { key: 'travel-places', label: 'Travel & Places' },
  { key: 'culture-society', label: 'Culture & Society' },
  { key: 'history', label: 'History' },
  { key: 'science-nature', label: 'Science & Nature' },
  { key: 'technology', label: 'Technology' },
  { key: 'work-ambition', label: 'Work & Ambition' },
  { key: 'food-cooking', label: 'Food & Cooking' },
  { key: 'health-wellbeing', label: 'Health & Wellbeing' },
  { key: 'sport-fitness', label: 'Sport & Fitness' },
  { key: 'everyday-life', label: 'Everyday Life' },
]

const INTEREST_KEY_SET = new Set(INTEREST_TAXONOMY.map((i) => i.key))

export function isValidInterestKey(key: string): boolean {
  return INTEREST_KEY_SET.has(key)
}

/** HARD-required at new-profile creation (app/profile/profile-form.tsx
 * blocks submission below this count) — but only ever a soft hint, never
 * enforced, when an EXISTING member edits their selection later
 * (app/you/interests): they may freely drop to zero if they genuinely
 * want to, and must keep receiving the ordinary (Phase 2A) Board
 * experience when they do. Same constant, two different enforcement
 * contexts — deliberately not two separate constants, since the
 * NUMBER itself is one product decision; whether it's enforced is a
 * per-surface UI decision layered on top. */
export const MIN_RECOMMENDED_INTERESTS = 3
export const MAX_INTERESTS = 8

/** Pure: the EXACT new-profile-creation gate — app/profile/profile-
 * form.tsx blocks submission unless this is true. Extracted as its own
 * function (rather than an inline comparison) purely so the precise 3–8
 * business rule has one, directly unit-tested definition — this codebase
 * has no interactive component-test harness (no @testing-library/react,
 * only pre-mount SSR rendering — see e.g. dispatch-composer.test.tsx's
 * own documented limitation), so a component-level test can't actually
 * simulate "select 2 chips, submit, see it blocked." The existing-member
 * editor (app/you/interests) deliberately never calls this — 0 is
 * always a valid save there; see MIN_RECOMMENDED_INTERESTS's own
 * comment for why the same number means something different there. */
export function isReadingInterestsCountValidForNewProfile(count: number): boolean {
  return count >= MIN_RECOMMENDED_INTERESTS && count <= MAX_INTERESTS
}

/**
 * Curated alias/keyword lists per Interest — every alias is already
 * normalized (lowercase, single space, no punctuation). A single-word
 * alias matches a whole TOKEN of a normalized Dispatch topic; a
 * multi-word alias (contains a space) matches only the WHOLE normalized
 * topic phrase — never a bare substring. This is what keeps "art" from
 * ever matching "earth": tokenized, "earth" is one token that is never
 * equal to the token "art".
 */
export const INTEREST_ALIASES: Record<string, string[]> = {
  'life-reflections': [
    'life', 'reflection', 'reflections', 'gratitude', 'grief', 'loss', 'journal',
    'journaling', 'growth', 'healing', 'change', 'memory', 'memories', 'aging',
    'forgiveness', 'boundaries', 'loneliness',
  ],
  'family-parenting': [
    'family', 'parenting', 'parenthood', 'motherhood', 'fatherhood', 'children',
    'kids', 'siblings', 'grandparents', 'home life',
  ],
  friendship: ['friendship', 'friends', 'best friend', 'belonging'],
  'love-relationships': [
    'love', 'dating', 'romance', 'marriage', 'relationships', 'breakup', 'heartbreak',
    'crush', 'partner', 'partners', 'divorce', 'intimacy', 'husband', 'husbands',
    'wife', 'wives', 'reconciliation', 'separation', 'marital conflict',
    'relationship conflict',
  ],
  'spirituality-faith': [
    'faith', 'spirituality', 'christianity', 'bible', 'prayer', 'church', 'islam',
    'judaism', 'buddhism', 'hinduism', 'meditation', 'god', 'religion', 'sacred',
  ],
  philosophy: [
    'philosophy', 'ethics', 'meaning', 'existentialism', 'stoicism', 'metaphysics',
    'morality', 'wisdom',
  ],
  psychology: [
    'psychology', 'mind', 'emotions', 'feelings', 'therapy', 'mental health',
    'human nature', 'self', 'identity', 'anxiety',
  ],
  'books-literature': [
    'books', 'book', 'literature', 'novel', 'novels', 'reading', 'fiction',
    'nonfiction', 'library', 'bookclub', 'book club',
  ],
  'writing-poetry': [
    'writing', 'poetry', 'poems', 'poem', 'journaling', 'essays', 'essay',
    'storytelling', 'creative writing',
  ],
  'art-creativity': [
    'art', 'painting', 'drawing', 'creativity', 'design', 'sculpture', 'illustration',
    'photography', 'crafts',
  ],
  music: ['music', 'songs', 'song', 'singing', 'concerts', 'guitar', 'piano', 'jazz', 'hip hop'],
  'film-tv': ['film', 'films', 'movies', 'movie', 'cinema', 'television', 'tv', 'series', 'documentary'],
  'travel-places': [
    'travel', 'travelling', 'traveling', 'places', 'adventure', 'backpacking',
    'wanderlust', 'abroad', 'roadtrip', 'road trip',
  ],
  'culture-society': [
    'culture', 'society', 'identity', 'immigration', 'diaspora', 'community',
    'politics', 'social justice', 'language',
  ],
  history: ['history', 'historical', 'heritage', 'ancestry', 'genealogy', 'archaeology'],
  'science-nature': [
    'science', 'nature', 'biology', 'physics', 'astronomy', 'space', 'animals',
    'wildlife', 'environment', 'climate', 'gardening',
  ],
  technology: ['technology', 'tech', 'software', 'coding', 'programming', 'internet', 'ai', 'gadgets'],
  'work-ambition': [
    'work', 'career', 'business', 'entrepreneurship', 'startup', 'startups',
    'ambition', 'leadership', 'productivity', 'job', 'jobs',
  ],
  'food-cooking': ['food', 'cooking', 'baking', 'recipes', 'recipe', 'cuisine', 'restaurants', 'coffee', 'wine'],
  'health-wellbeing': ['health', 'wellbeing', 'wellness', 'sleep', 'mindfulness', 'self care', 'nutrition'],
  'sport-fitness': ['sport', 'sports', 'fitness', 'running', 'football', 'soccer', 'basketball', 'yoga', 'gym'],
  'everyday-life': ['everyday', 'daily life', 'routine', 'home', 'mundane', 'ordinary'],
}

/** Pure: lowercases, strips punctuation to spaces, collapses whitespace —
 * the SAME normalization docs/sql/2026-09-27-topical-interests.sql's own
 * tempa_private.normalize_topic_text applies, so a topic and its stored
 * alias are compared on equal footing in both places. */
export function normalizeTopicText(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pure: the one Dispatch-topic → Interest(s) matching rule for this
 * checkpoint. A topic can match more than one Interest (e.g. "faith"
 * could plausibly also be curated under a second alias list). Exact
 * whole-phrase match OR exact single-token match only — never a
 * substring scan, so "art" (topic) matches the alias "art" but "earth"
 * (topic, tokenizes to the single token "earth") never does, regardless
 * of "art" being a substring of "earth".
 */
export function matchTopicToInterests(topic: string): string[] {
  const normalized = normalizeTopicText(topic)
  if (normalized.length === 0) return []
  const tokens = normalized.split(' ')

  const matched: string[] = []
  for (const [interestKey, aliases] of Object.entries(INTEREST_ALIASES)) {
    const isMatch = aliases.some((alias) =>
      alias.includes(' ') ? alias === normalized : tokens.includes(alias)
    )
    if (isMatch) matched.push(interestKey)
  }
  return matched
}

/** Pure: the union of Interests matched across every one of a Dispatch's
 * (up to 3) topics — used by the ranking simulation and by any future
 * caller that needs "does this Dispatch touch any of these Interests." */
export function matchDispatchTopicsToInterests(topics: string[]): Set<string> {
  const result = new Set<string>()
  for (const topic of topics) {
    for (const key of matchTopicToInterests(topic)) result.add(key)
  }
  return result
}

/** Pure: whether a Dispatch's topics touch ANY of the viewer's selected
 * Interests — the single boolean the ranking tie-break needs. Returns
 * false (never throws, never treats it as a mismatch penalty) when
 * either list is empty — the exact "zero-interest degrades to no
 * preference at all" behavior this checkpoint requires. */
export function dispatchMatchesInterests(dispatchTopics: string[], viewerInterestKeys: string[]): boolean {
  if (viewerInterestKeys.length === 0 || dispatchTopics.length === 0) return false
  const viewerKeys = new Set(viewerInterestKeys)
  for (const topic of dispatchTopics) {
    for (const key of matchTopicToInterests(topic)) {
      if (viewerKeys.has(key)) return true
    }
  }
  return false
}
