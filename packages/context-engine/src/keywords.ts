/**
 * Deterministic task-keyword extraction. No model, no embeddings, no NLP
 * dependency — lowercase, tokenize, drop stop words / task-verb noise, then
 * expand a few recognized technical terms through a small curated map. Not
 * a general-purpose thesaurus — just enough to turn "Implement JWT
 * authentication" into a keyword set that actually matches related files
 * (session/login/middleware) that never appear in the task text itself.
 */

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'is',
  'are',
  'be',
  'this',
  'that',
  'it',
  'its',
  'as',
  'into',
  'from',
  'we',
  'need',
  'should',
  'must',
  'want',
  'new',
  'please',
  // task-verb noise: near-universal across tasks, no file-relevance signal
  'implement',
  'add',
  'create',
  'update',
  'fix',
  'remove',
  'refactor',
  'build',
  'write',
  'make'
]);

const MIN_KEYWORD_LENGTH = 2;

const TECHNICAL_TERM_EXPANSIONS: Record<string, readonly string[]> = {
  jwt: ['auth', 'authentication', 'token', 'session'],
  auth: ['authentication', 'authorization', 'login', 'session', 'token'],
  authentication: ['auth', 'login', 'session', 'token', 'middleware'],
  authorization: ['auth', 'permission', 'role'],
  login: ['auth', 'authentication', 'session', 'credential'],
  session: ['auth', 'token', 'cookie'],
  token: ['jwt', 'auth', 'session'],
  api: ['endpoint', 'route', 'controller'],
  database: ['db', 'schema', 'migration', 'model'],
  db: ['database', 'schema', 'migration'],
  payment: ['billing', 'checkout', 'invoice']
};

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_KEYWORD_LENGTH);
}

/** Same input always produces the same output — no locale/timing/randomness dependency. Output is sorted for reproducibility. */
export function extractTaskKeywords(taskDescription: string): readonly string[] {
  const baseTokens = tokenize(taskDescription).filter((token) => !STOP_WORDS.has(token));

  const expanded = new Set<string>(baseTokens);
  for (const token of baseTokens) {
    const expansions = TECHNICAL_TERM_EXPANSIONS[token];
    if (expansions) {
      for (const expansion of expansions) {
        expanded.add(expansion);
      }
    }
  }

  return [...expanded].sort();
}
