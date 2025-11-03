// Human-friendly slug generator similar to Vercel/Convex style
// Format: adjective-noun-number (e.g., purple-butterfly-42)

const ADJECTIVES = [
  "amber",
  "azure",
  "bold",
  "brave",
  "bright",
  "calm",
  "cool",
  "cosmic",
  "crystal",
  "daring",
  "eager",
  "elegant",
  "emerald",
  "epic",
  "fast",
  "fierce",
  "gentle",
  "golden",
  "happy",
  "humble",
  "jolly",
  "kind",
  "lively",
  "lucky",
  "mighty",
  "noble",
  "proud",
  "quiet",
  "rapid",
  "royal",
  "sage",
  "serene",
  "silver",
  "smart",
  "swift",
  "tender",
  "violet",
  "wild",
  "wise",
  "zen",
];

const NOUNS = [
  "aurora",
  "breeze",
  "butterfly",
  "cascade",
  "cloud",
  "comet",
  "compass",
  "coral",
  "crystal",
  "dawn",
  "dune",
  "echo",
  "falcon",
  "feather",
  "firefly",
  "forest",
  "galaxy",
  "glacier",
  "harbor",
  "horizon",
  "island",
  "lagoon",
  "meadow",
  "meteor",
  "moon",
  "mountain",
  "nebula",
  "ocean",
  "orchid",
  "phoenix",
  "prism",
  "quasar",
  "rainbow",
  "river",
  "shadow",
  "spark",
  "star",
  "summit",
  "valley",
  "wave",
];

/**
 * Generate a random human-friendly slug.
 * Format: adjective-noun-number (e.g., "happy-cloud-789")
 */
export function generateSlug(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 900) + 100; // 100-999

  return `${adjective}-${noun}-${number}`;
}
