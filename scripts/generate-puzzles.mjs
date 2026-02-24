import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DAYS = 365;

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseStartDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error('Invalid --start value. Use YYYY-MM-DD.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error('Invalid --start calendar date.');
  }

  return date;
}

function stringToSeed(value) {
  let seed = 0;
  for (let i = 0; i < value.length; i += 1) {
    seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  }
  return seed;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv, rootDir) {
  const options = {
    days: DEFAULT_DAYS,
    out: path.resolve(rootDir, 'src/puzzles.json'),
    words: null,
    startDate: new Date(),
  };

  options.startDate = new Date(
    options.startDate.getFullYear(),
    options.startDate.getMonth(),
    options.startDate.getDate(),
  );

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      console.log(
        [
          'Generate deterministic Dwindle puzzles.',
          '',
          'Usage:',
          '  node scripts/generate-puzzles.mjs [--days 365] [--start YYYY-MM-DD] [--out src/puzzles.json] [--words src/words.txt]',
        ].join('\n'),
      );
      process.exit(0);
    }

    if (token === '--days') {
      const value = argv[i + 1];
      i += 1;
      options.days = Number.parseInt(value, 10);
      continue;
    }

    if (token.startsWith('--days=')) {
      options.days = Number.parseInt(token.slice('--days='.length), 10);
      continue;
    }

    if (token === '--start') {
      const value = argv[i + 1];
      i += 1;
      options.startDate = parseStartDate(value);
      continue;
    }

    if (token.startsWith('--start=')) {
      options.startDate = parseStartDate(token.slice('--start='.length));
      continue;
    }

    if (token === '--out') {
      const value = argv[i + 1];
      i += 1;
      options.out = path.resolve(rootDir, value);
      continue;
    }

    if (token.startsWith('--out=')) {
      options.out = path.resolve(rootDir, token.slice('--out='.length));
      continue;
    }

    if (token === '--words') {
      const value = argv[i + 1];
      i += 1;
      options.words = path.resolve(rootDir, value);
      continue;
    }

    if (token.startsWith('--words=')) {
      options.words = path.resolve(rootDir, token.slice('--words='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(options.days) || options.days <= 0) {
    throw new Error('--days must be a positive integer.');
  }

  return options;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findDefaultWordsPath(rootDir) {
  const wordsTxtPath = path.resolve(rootDir, 'src/words.txt');
  if (await pathExists(wordsTxtPath)) {
    return wordsTxtPath;
  }

  const wordsJsonPath = path.resolve(rootDir, 'src/words.json');
  if (await pathExists(wordsJsonPath)) {
    return wordsJsonPath;
  }

  throw new Error('No words file found. Add src/words.txt or src/words.json, or pass --words.');
}

function parseWords(rawWords, wordsPath) {
  if (path.extname(wordsPath).toLowerCase() === '.json') {
    const words = JSON.parse(rawWords);
    if (!Array.isArray(words)) {
      throw new Error(`${path.basename(wordsPath)} must be a JSON array of words.`);
    }
    return words;
  }

  return rawWords
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function sortedLetters(word) {
  return [...word].sort().join('');
}

function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildEngine(words) {
  const dictionary = [
    ...new Set(
      words
        .filter((word) => typeof word === 'string')
        .map((word) => word.trim().toUpperCase())
        .filter((word) => /^[A-Z]{3,7}$/.test(word)),
    ),
  ];

  const buckets = new Map();
  const nextWordCache = new Map();

  for (const word of dictionary) {
    const key = sortedLetters(word);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(word);
  }

  function getNextWords(word) {
    if (nextWordCache.has(word)) {
      return nextWordCache.get(word);
    }

    if (word.length <= 3) {
      nextWordCache.set(word, []);
      return [];
    }

    const sorted = sortedLetters(word);
    const seenSignatures = new Set();
    const candidates = new Set();

    for (let i = 0; i < sorted.length; i += 1) {
      const signature = sorted.slice(0, i) + sorted.slice(i + 1);
      if (seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);

      const wordsForSignature = buckets.get(signature) ?? [];
      for (const candidate of wordsForSignature) {
        candidates.add(candidate);
      }
    }

    const result = [...candidates].sort();
    nextWordCache.set(word, result);
    return result;
  }

  const solvableMemo = new Map();

  function isSolvable(word) {
    if (word.length === 3) {
      return true;
    }

    if (solvableMemo.has(word)) {
      return solvableMemo.get(word);
    }

    for (const nextWord of getNextWords(word)) {
      if (isSolvable(nextWord)) {
        solvableMemo.set(word, true);
        return true;
      }
    }

    solvableMemo.set(word, false);
    return false;
  }

  function buildChain(startWord, random) {
    function dfs(word) {
      if (word.length === 3) {
        return [word];
      }

      const orderedCandidates = shuffled(getNextWords(word), random);
      for (const nextWord of orderedCandidates) {
        const tail = dfs(nextWord);
        if (tail) {
          return [word, ...tail];
        }
      }

      return null;
    }

    return dfs(startWord);
  }

  const validSevenLetterWords = dictionary
    .filter((word) => word.length === 7)
    .filter((word) => isSolvable(word))
    .sort();

  if (!validSevenLetterWords.length) {
    throw new Error('No solvable 7-letter words found. Add more words to the dictionary source.');
  }

  return {
    dictionary,
    validSevenLetterWords,
    buildChain,
  };
}

function generatePuzzles({ startDate, days }, engine) {
  const puzzles = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + offset);
    const dateString = getLocalDateString(date);

    const random = mulberry32(stringToSeed(dateString));
    const index = Math.floor(random() * engine.validSevenLetterWords.length);
    const startWord = engine.validSevenLetterWords[index];

    const chain = engine.buildChain(startWord, random);
    if (!chain || chain.length !== 5) {
      throw new Error(`Could not build full 7→3 chain for ${dateString} (${startWord}).`);
    }

    puzzles.push({
      date: dateString,
      startWord,
      words: chain,
      solution: {
        six: chain[1],
        five: chain[2],
        four: chain[3],
        three: chain[4],
      },
    });
  }

  return puzzles;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '..');

  const options = parseArgs(process.argv.slice(2), rootDir);
  const wordsPath = options.words ?? (await findDefaultWordsPath(rootDir));
  const wordsRaw = await readFile(wordsPath, 'utf8');
  const words = parseWords(wordsRaw, wordsPath);

  const engine = buildEngine(words);
  const puzzles = generatePuzzles(options, engine);

  const output = {
    generatedAt: new Date().toISOString(),
    startDate: getLocalDateString(options.startDate),
    days: options.days,
    dictionarySize: engine.dictionary.length,
    solvableSevenLetterWords: engine.validSevenLetterWords.length,
    puzzles,
  };

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Generated ${puzzles.length} puzzles.`);
  console.log(`Output: ${path.relative(rootDir, options.out)}`);
  console.log(`Words source: ${path.relative(rootDir, wordsPath)}`);
  console.log(`Solvable 7-letter words: ${engine.validSevenLetterWords.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
