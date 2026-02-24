import { useCallback, useEffect, useMemo, useState } from 'react';
import puzzleBook from './puzzles.json';
import './App.css';

const STORAGE_KEY = 'dwindle-state';
const HOW_TO_MODAL_STORAGE_KEY = 'dwindle-howto-dismissed';
const TARGET_LENGTHS = [6, 5, 4, 3];
const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const MAX_RETRIES = 2;
const STEP_ADVANCE_MS = 420;
const SHARE_ROW_EMOJIS = {
  clean: '🟩',
  retry: '🟨',
  fail: '🟥',
  pending: '⬜',
};
const HOW_TO_EXAMPLES = [
  {
    rows: [
      { label: 7, word: 'SEVENTH', type: 'filled' },
      { label: 6, word: 'EVENTS', type: 'filled' },
      { label: 5, word: 'TEENS', type: 'filled' },
    ],
  },
  {
    rows: [
      { label: 7, word: 'SECULAR', type: 'filled' },
      { label: 6, word: 'CLAUSE', type: 'filled' },
      {
        label: '\u00D7',
        word: 'SAUCE',
        type: 'feedback',
        feedback: buildFeedback('SAUCE', 'CAUSE'),
      },
      { label: 5, word: 'CAUSE', type: 'filled' },
    ],
    note: (
      <>
        Green = right letter in the right spot.
        <br />
        Yellow = right letter in the wrong spot.
      </>
    ),
  },
];
const RANDOM_PUZZLE_MODE =
  import.meta.env.VITE_RANDOM_PUZZLES === 'true' || import.meta.env.VITE_RANDOM_PUZZLES === '1';

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeWord(value, expectedLength) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    return '';
  }

  if (expectedLength && normalized.length !== expectedLength) {
    return '';
  }

  return normalized;
}

function normalizePuzzle(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const date = typeof entry.date === 'string' ? entry.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const startWord =
    normalizeWord(entry.startWord, 7) ||
    normalizeWord(Array.isArray(entry.words) ? entry.words[0] : '', 7);

  let targetWords = [];
  if (entry.solution && typeof entry.solution === 'object') {
    targetWords = [
      normalizeWord(entry.solution.six, 6),
      normalizeWord(entry.solution.five, 5),
      normalizeWord(entry.solution.four, 4),
      normalizeWord(entry.solution.three, 3),
    ];
  }

  if (targetWords.some((word) => !word) && Array.isArray(entry.words)) {
    targetWords = TARGET_LENGTHS.map((length, index) =>
      normalizeWord(entry.words[index + 1], length),
    );
  }

  if (!startWord || targetWords.some((word) => !word)) {
    return null;
  }

  return { date, startWord, targetWords };
}

function buildFeedback(guess, target) {
  const states = Array.from({ length: target.length }, () => 'absent');
  const remaining = new Map();

  for (let i = 0; i < target.length; i += 1) {
    if (guess[i] === target[i]) {
      states[i] = 'correct';
    } else {
      const count = remaining.get(target[i]) ?? 0;
      remaining.set(target[i], count + 1);
    }
  }

  for (let i = 0; i < target.length; i += 1) {
    if (states[i] === 'correct') {
      continue;
    }

    const letter = guess[i];
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      states[i] = 'present';
      remaining.set(letter, count - 1);
    }
  }

  return states;
}

function createEmptyAttemptsByStep() {
  return TARGET_LENGTHS.map(() => []);
}

function createEmptyState() {
  return {
    guesses: [],
    attemptsByStep: createEmptyAttemptsByStep(),
    lockedOut: false,
  };
}

const RAW_PUZZLES = Array.isArray(puzzleBook?.puzzles) ? puzzleBook.puzzles : [];
const NORMALIZED_PUZZLES = RAW_PUZZLES.map((entry) => normalizePuzzle(entry)).filter((entry) =>
  Boolean(entry),
);
const DAILY_PUZZLES = new Map(NORMALIZED_PUZZLES.map((entry) => [entry.date, entry]));
const PUZZLE_DATES = NORMALIZED_PUZZLES.map((entry) => entry.date);

function pickRandomPuzzleDate(excludeDate = '') {
  if (!PUZZLE_DATES.length) {
    return '';
  }

  if (PUZZLE_DATES.length === 1) {
    return PUZZLE_DATES[0];
  }

  let choice = excludeDate;
  while (choice === excludeDate) {
    const index = Math.floor(Math.random() * PUZZLE_DATES.length);
    choice = PUZZLE_DATES[index];
  }

  return choice;
}

function clearStoredState() {
  localStorage.removeItem(STORAGE_KEY);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

function loadStoredState(puzzleDate, puzzle, mode) {
  const empty = createEmptyState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return empty;
    }

    const parsed = JSON.parse(raw);
    const storedMode = parsed?.mode === 'random' ? 'random' : 'daily';
    const storedPuzzleDate = typeof parsed?.puzzleDate === 'string' ? parsed.puzzleDate : parsed?.date;

    if (
      !parsed ||
      storedMode !== mode ||
      storedPuzzleDate !== puzzleDate ||
      parsed.startWord !== puzzle.startWord ||
      !Array.isArray(parsed.guesses)
    ) {
      return empty;
    }

    const validGuesses = [];
    for (let step = 0; step < TARGET_LENGTHS.length; step += 1) {
      const guess = normalizeWord(parsed.guesses[step], TARGET_LENGTHS[step]);
      if (!guess || guess !== puzzle.targetWords[step]) {
        break;
      }
      validGuesses.push(guess);
    }

    const attemptsByStep = createEmptyAttemptsByStep();
    const rawAttemptsByStep = Array.isArray(parsed.attemptsByStep) ? parsed.attemptsByStep : null;
    if (rawAttemptsByStep) {
      for (let step = 0; step < TARGET_LENGTHS.length; step += 1) {
        const rowAttempts = rawAttemptsByStep[step];
        if (!Array.isArray(rowAttempts)) {
          continue;
        }

        for (const rawAttempt of rowAttempts) {
          if (attemptsByStep[step].length >= MAX_RETRIES) {
            break;
          }

          const attemptWord = normalizeWord(rawAttempt, TARGET_LENGTHS[step]);
          const targetWord = puzzle.targetWords[step];
          if (!attemptWord || attemptWord === targetWord) {
            continue;
          }

          attemptsByStep[step].push({
            guess: attemptWord,
            feedback: buildFeedback(attemptWord, targetWord),
          });
        }
      }
    } else if (
      Array.isArray(parsed.attempts) &&
      Number.isInteger(parsed.activeStep) &&
      parsed.activeStep >= 0 &&
      parsed.activeStep < TARGET_LENGTHS.length
    ) {
      const step = parsed.activeStep;
      const targetWord = puzzle.targetWords[step];

      for (const rawAttempt of parsed.attempts) {
        if (attemptsByStep[step].length >= MAX_RETRIES) {
          break;
        }

        const attemptWord = normalizeWord(rawAttempt, TARGET_LENGTHS[step]);
        if (!attemptWord || attemptWord === targetWord) {
          continue;
        }

        attemptsByStep[step].push({
          guess: attemptWord,
          feedback: buildFeedback(attemptWord, targetWord),
        });
      }
    }

    const solved = validGuesses.length >= TARGET_LENGTHS.length;
    const activeStep = validGuesses.length;
    const activeAttempts =
      activeStep < TARGET_LENGTHS.length ? (attemptsByStep[activeStep] ?? []).length : 0;
    const lockedOut = solved
      ? false
      : Boolean(parsed.lockedOut) || Boolean(parsed.failed) || activeAttempts >= MAX_RETRIES;

    return {
      guesses: validGuesses,
      attemptsByStep,
      lockedOut,
    };
  } catch {
    return empty;
  }
}

function App() {
  const [currentDate, setCurrentDate] = useState(() => getLocalDateString());
  const [activePuzzleDate, setActivePuzzleDate] = useState(() => {
    const today = getLocalDateString();
    if (!RANDOM_PUZZLE_MODE) {
      return today;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return pickRandomPuzzleDate();
      }

      const parsed = JSON.parse(raw);
      const storedPuzzleDate = typeof parsed?.puzzleDate === 'string' ? parsed.puzzleDate : '';
      const solved = Array.isArray(parsed?.guesses) && parsed.guesses.length >= TARGET_LENGTHS.length;
      const locked = Boolean(parsed?.lockedOut) || Boolean(parsed?.failed);

      if (
        parsed?.mode === 'random' &&
        storedPuzzleDate &&
        DAILY_PUZZLES.has(storedPuzzleDate) &&
        !solved &&
        !locked
      ) {
        return storedPuzzleDate;
      }
    } catch {
      return pickRandomPuzzleDate();
    }

    return pickRandomPuzzleDate();
  });

  const puzzle = useMemo(() => DAILY_PUZZLES.get(activePuzzleDate) ?? null, [activePuzzleDate]);
  const startWord = puzzle?.startWord ?? '';
  const targetWords = puzzle?.targetWords ?? [];
  const [guesses, setGuesses] = useState([]);
  const [attemptsByStep, setAttemptsByStep] = useState(createEmptyAttemptsByStep());
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [roundSeed, setRoundSeed] = useState(0);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [toasts, setToasts] = useState([]);
  const [pendingAdvance, setPendingAdvance] = useState(null);
  const [isHowToModalOpen, setIsHowToModalOpen] = useState(() => {
    try {
      return localStorage.getItem(HOW_TO_MODAL_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const showToast = useCallback((message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((previous) => [...previous, { id, message }]);

    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 2600);
  }, []);

  const dismissHowToModal = useCallback(() => {
    setIsHowToModalOpen(false);

    try {
      localStorage.setItem(HOW_TO_MODAL_STORAGE_KEY, '1');
    } catch {
      // Ignore localStorage failures and only close this session.
    }
  }, []);

  const openHowToModal = useCallback(() => {
    setIsHowToModalOpen(true);
  }, []);

  useEffect(() => {
    setIsHydrated(false);
    const mode = RANDOM_PUZZLE_MODE ? 'random' : 'daily';
    const loaded = puzzle ? loadStoredState(activePuzzleDate, puzzle, mode) : createEmptyState();
    setGuesses(loaded.guesses);
    setAttemptsByStep(loaded.attemptsByStep);
    setIsLockedOut(loaded.lockedOut);
    setInputValue('');
    setPendingAdvance(null);
    setShowScoreModal(false);
    setIsHydrated(true);
  }, [activePuzzleDate, puzzle, roundSeed]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!puzzle) {
      clearStoredState();
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: RANDOM_PUZZLE_MODE ? 'random' : 'daily',
        date: currentDate,
        puzzleDate: activePuzzleDate,
        startWord: puzzle.startWord,
        guesses,
        attemptsByStep: attemptsByStep.map((row) => row.map((attempt) => attempt.guess)),
        lockedOut: isLockedOut,
      }),
    );
  }, [
    currentDate,
    activePuzzleDate,
    puzzle,
    guesses,
    attemptsByStep,
    isLockedOut,
    isHydrated,
  ]);

  useEffect(() => {
    const syncDate = () => {
      const latestDate = getLocalDateString();
      if (latestDate !== currentDate) {
        if (!RANDOM_PUZZLE_MODE) {
          clearStoredState();
          setActivePuzzleDate(latestDate);
        }
        setCurrentDate(latestDate);
      }
    };

    const intervalId = window.setInterval(syncDate, 60000);
    window.addEventListener('focus', syncDate);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncDate);
    };
  }, [currentDate]);

  const currentStep = guesses.length;
  const isAdvancing = Boolean(pendingAdvance);
  const isComplete = puzzle ? currentStep >= TARGET_LENGTHS.length : false;
  const expectedLength = !puzzle || isComplete ? 0 : TARGET_LENGTHS[currentStep];
  const priorWord = currentStep === 0 ? startWord : guesses[currentStep - 1];
  const targetWord = !puzzle || isComplete ? '' : targetWords[currentStep];
  const finalScoreLength = guesses.length ? guesses[guesses.length - 1].length : 7;
  const isInputLocked = !puzzle || isComplete || isLockedOut || isHowToModalOpen || isAdvancing;
  const isRoundFinished = isComplete || isLockedOut;
  const isScoreModalOpen = showScoreModal && isRoundFinished && !isHowToModalOpen;
  const didWin = isComplete && !isLockedOut;
  const solvedMessage = RANDOM_PUZZLE_MODE
    ? 'Puzzle solved.'
    : "You solved today's Dwindle. Come back tomorrow for a new puzzle.";
  const lockoutMessage = RANDOM_PUZZLE_MODE
    ? `Final score: ${finalScoreLength}`
    : `Locked until tomorrow. Final score: ${finalScoreLength}`;
  const modalTitle = didWin ? 'You Won' : 'You Failed';
  const modalOutcomeText = didWin
    ? 'You completed every row.'
    : RANDOM_PUZZLE_MODE
      ? 'No retries left for this puzzle.'
      : 'No retries left. Locked until tomorrow.';
  const previousStepIndex = currentStep - 1;
  const previousLength = TARGET_LENGTHS[previousStepIndex] ?? 0;
  const previousGuess = previousStepIndex >= 0 ? guesses[previousStepIndex] ?? '' : '';
  const activeLength = TARGET_LENGTHS[currentStep] ?? 0;
  const activeRowAttempts = attemptsByStep[currentStep] ?? [];
  const shareEmojiLine = TARGET_LENGTHS.map((_, stepIndex) => {
    if (stepIndex < guesses.length) {
      const usedRetry = (attemptsByStep[stepIndex] ?? []).length > 0;
      return usedRetry ? SHARE_ROW_EMOJIS.retry : SHARE_ROW_EMOJIS.clean;
    }

    if (isLockedOut && stepIndex >= guesses.length) {
      return SHARE_ROW_EMOJIS.fail;
    }

    return SHARE_ROW_EMOJIS.pending;
  }).join('');
  const shareText = `Dwindle ${activePuzzleDate || currentDate}\n${shareEmojiLine}`;
  const shareGameUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
  const clipboardShareText = shareGameUrl ? `${shareText}\n${shareGameUrl}` : shareText;

  useEffect(() => {
    if (!pendingAdvance) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setGuesses((previous) => [...previous, pendingAdvance.guess]);
      setPendingAdvance(null);
    }, STEP_ADVANCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingAdvance]);

  useEffect(() => {
    if (!isHydrated || !puzzle || !isRoundFinished) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowScoreModal(true);
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isHydrated, puzzle, isRoundFinished]);

  const startNextRandomPuzzle = useCallback(() => {
    if (!RANDOM_PUZZLE_MODE) {
      return;
    }

    const nextPuzzleDate = pickRandomPuzzleDate(activePuzzleDate);
    if (!nextPuzzleDate) {
      return;
    }

    clearStoredState();
    setShowScoreModal(false);

    if (nextPuzzleDate === activePuzzleDate) {
      setRoundSeed((previous) => previous + 1);
      return;
    }

    setActivePuzzleDate(nextPuzzleDate);
  }, [activePuzzleDate]);

  const submitGuess = useCallback(() => {
    if (!puzzle) {
      showToast(`No puzzle found for ${currentDate}. Run generate:puzzles.`);
      return;
    }

    if (isComplete) {
      showToast(RANDOM_PUZZLE_MODE ? 'Solved. Tap New Puzzle for another round.' : 'Puzzle already solved.');
      return;
    }

    if (isLockedOut) {
      showToast(lockoutMessage);
      return;
    }

    const guess = inputValue.trim().toUpperCase();
    if (guess.length !== expectedLength) {
      showToast(`Enter a ${expectedLength}-letter word.`);
      return;
    }

    if (guess === targetWord) {
      if (currentStep === 0) {
        setGuesses((previous) => [...previous, guess]);
      } else {
        setPendingAdvance({ stepIndex: currentStep, guess });
      }
      setInputValue('');
      return;
    }

    const currentRowAttempts = attemptsByStep[currentStep]?.length ?? 0;
    const nextRowAttempts = Math.min(MAX_RETRIES, currentRowAttempts + 1);
    setAttemptsByStep((previous) => {
      const next = previous.map((row) => [...row]);
      next[currentStep].push({
        guess,
        feedback: buildFeedback(guess, targetWord),
      });
      return next;
    });
    setInputValue('');

    if (nextRowAttempts >= MAX_RETRIES) {
      setIsLockedOut(true);
      showToast(lockoutMessage);
      return;
    }

    showToast(`Not quite. ${MAX_RETRIES - nextRowAttempts} retries left for this row.`);
  }, [
    puzzle,
    currentDate,
    isComplete,
    isLockedOut,
    lockoutMessage,
    inputValue,
    expectedLength,
    targetWord,
    attemptsByStep,
    currentStep,
    showToast,
  ]);

  const shareResult = useCallback(async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Dwindle',
          text: shareText,
          ...(shareGameUrl ? { url: shareGameUrl } : {}),
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      const copied = await copyTextToClipboard(clipboardShareText);
      showToast(copied ? 'Result copied to clipboard.' : 'Unable to share result.');
    } catch {
      showToast('Unable to share result.');
    }
  }, [clipboardShareText, shareGameUrl, shareText, showToast]);

  const handleGameKey = useCallback(
    (key) => {
      if (isInputLocked) {
        return;
      }

      if (key === 'ENTER') {
        submitGuess();
        return;
      }

      if (key === 'BACKSPACE') {
        setInputValue((previous) => previous.slice(0, -1));
        return;
      }

      if (!/^[A-Z]$/.test(key)) {
        return;
      }

      setInputValue((previous) => {
        if (previous.length >= expectedLength) {
          return previous;
        }
        return `${previous}${key}`;
      });
    },
    [expectedLength, isInputLocked, submitGuess],
  );

  useEffect(() => {
    const handleWindowKeyDown = (event) => {
      if (isHowToModalOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismissHowToModal();
        }
        return;
      }

      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleGameKey('ENTER');
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        handleGameKey('BACKSPACE');
        return;
      }

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        handleGameKey(event.key.toUpperCase());
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [dismissHowToModal, handleGameKey, isHowToModalOpen]);

  return (
    <div className="app-shell">
      <section className="card">
        <button
          type="button"
          className="help-button"
          onClick={openHowToModal}
          aria-label="Open instructions"
          title="How to play"
        >
          ?
        </button>

        <header className="title-group">
          <h1>Dwindle</h1>
          <p>{RANDOM_PUZZLE_MODE ? 'Random Mode' : currentDate}</p>
        </header>

        <div className="start-block" aria-label="Daily starting word">
          <div className="start-word">{startWord || 'NO PUZZLE'}</div>
        </div>

        {isRoundFinished ? (
          <div className="solution-screen" aria-label="Puzzle answers">
            {[startWord, ...targetWords].map((word, index) => (
              <div
                key={`${word}-${index}`}
                className={`solution-item ${
                  index > 0 && index - 1 < guesses.length
                    ? 'correct'
                    : isLockedOut && index - 1 === guesses.length
                      ? 'incorrect'
                      : ''
                }`}
              >
                <span className="solution-length">{word.length}</span>
                <span className="solution-word">{word}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="board" aria-label="Current puzzle board">
            <div className="step-group">
              {TARGET_LENGTHS.map((length, stepIndex) => {
                if (stepIndex > currentStep) return null;

                const attempts = attemptsByStep[stepIndex] || [];
                const isCurrentStep = stepIndex === currentStep;
                const advancingGuess =
                  pendingAdvance && pendingAdvance.stepIndex === stepIndex
                    ? pendingAdvance.guess
                    : '';
                const guess = guesses[stepIndex] ?? advancingGuess;
                const isCollapsingTopRow = isAdvancing && stepIndex === currentStep - 1;
                const rowStateClass = stepIndex < currentStep - 1
                  ? 'collapsed'
                  : isCollapsingTopRow
                    ? 'collapsing'
                    : '';

                return [
                  ...attempts.map((attempt, attemptIndex) => {
                    const isCollapsed = !isCurrentStep && stepIndex < currentStep;
                    return (
                      <div
                        key={`${length}-retry-${attemptIndex}`}
                        className={`slot-row feedback-row ${isCollapsed ? 'collapsed' : ''}`}
                        style={{ '--delay': isCollapsed ? '0ms' : `${(previousGuess ? 1 : 0) * 50 + attemptIndex * 50}ms` }}
                      >
                        <span className="row-label retry-label">&times;</span>
                        <div className="slots">
                          {Array.from({ length }).map((_, slotIndex) => (
                            <span
                              key={`${length}-retry-${attemptIndex}-${slotIndex}`}
                              className={`slot typed feedback-${attempt.feedback[slotIndex]}`}
                            >
                              {attempt.guess[slotIndex] ?? ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  }),

                  (!isCurrentStep || (isAdvancing && stepIndex === currentStep)) && guess ? (
                    <div
                      key={`${length}-guess`}
                      className={`slot-row filled ${rowStateClass}`}
                      style={{ '--delay': '0ms' }}
                    >
                      <span className="row-label">{length}</span>
                      <div className="slots">
                        {Array.from({ length }).map((_, slotIndex) => (
                          <span key={`${length}-prev-slot-${slotIndex}`} className="slot typed">
                            {guess[slotIndex] ?? ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null
                ];
              })}

              {!isAdvancing && (
                <div
                  className="slot-row active"
                  style={{
                    '--delay': `${(previousGuess ? 1 : 0) * 50 + activeRowAttempts.length * 50}ms`,
                  }}
                >
                  <span className="row-label">{activeLength}</span>
                  <div className="slots">
                    {Array.from({ length: activeLength }).map((_, slotIndex) => (
                      <span
                        key={`${activeLength}-slot-${slotIndex}`}
                        className={`slot ${inputValue[slotIndex] ? 'typed' : ''} ${
                          slotIndex === inputValue.length && inputValue.length < activeLength
                            ? 'next-slot'
                            : ''
                        }`}
                      >
                        {inputValue[slotIndex] ?? ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {puzzle && (
                <p className="instruction instruction-inline">
                  {`Build a ${expectedLength}-letter word from ${priorWord}.`}
                </p>
              )}

              {puzzle && !isRoundFinished && (
                <div
                  className="retry-dots retry-dots-inline"
                  aria-label={`Retries used on this row: ${activeRowAttempts.length} of ${MAX_RETRIES}`}
                >
                  {Array.from({ length: MAX_RETRIES }).map((_, index) => (
                    <span
                      key={`retry-dot-${index}`}
                      className={`retry-dot ${index < activeRowAttempts.length ? 'used' : ''}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {puzzle ? (
          isRoundFinished ? (
            <p className={`instruction ${isLockedOut ? 'error' : ''}`}>
              {isComplete ? solvedMessage : lockoutMessage}
            </p>
          ) : null
        ) : (
          <p className="instruction error">
            {RANDOM_PUZZLE_MODE
              ? 'No puzzles available in src/puzzles.json. Run npm run generate:puzzles.'
              : `No puzzle exists for ${currentDate}. Run npm run generate:puzzles to create more days.`}
          </p>
        )}

        {RANDOM_PUZZLE_MODE && isRoundFinished && (
          <button type="button" className="next-puzzle-button" onClick={startNextRandomPuzzle}>
            New Puzzle
          </button>
        )}

        {!isRoundFinished && (
          <div className="keyboard" aria-label="On-screen keyboard">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div
                key={row}
                className={`keyboard-row ${rowIndex === 2 ? 'keyboard-row-bottom' : ''}`}
                style={{ '--cols': rowIndex === 2 ? 9 : row.length }}
              >
                {rowIndex === 2 && (
                  <button
                    type="button"
                    className="key key-wide"
                    onClick={() => handleGameKey('ENTER')}
                    disabled={isInputLocked}
                  >
                    Enter
                  </button>
                )}
                {[...row].map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    className="key"
                    onClick={() => handleGameKey(letter)}
                    disabled={isInputLocked}
                  >
                    {letter}
                  </button>
                ))}
                {rowIndex === 2 && (
                  <button
                    type="button"
                    className="key key-wide"
                    onClick={() => handleGameKey('BACKSPACE')}
                    disabled={isInputLocked}
                    aria-label="Delete last letter"
                  >
                    Del
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isHowToModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={dismissHowToModal}>
          <div
            className="how-to-modal"
            role="dialog"
            aria-modal="true"
            aria-label="How to play Dwindle"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>How to play</h2>
            <p className="how-to-intro">
              Build a shorter word each row using only letters from the previous word and removing one
              letter.
            </p>
            <p>
              You get a second chance for each word.
            </p>
            <p className="how-to-example-title">Examples</p>
            <div className="how-to-examples" aria-label="Example word chains">
              {HOW_TO_EXAMPLES.map((example, exampleIndex) => (
                <div key={`how-to-example-${exampleIndex}`} className="how-to-example-board">
                  {example.note && <p className="how-to-example-note">{example.note}</p>}
                  {example.rows.map((row, rowIndex) => (
                    <div
                      key={`${exampleIndex}-${row.type}-${row.word}-${rowIndex}`}
                      className={`slot-row ${row.type === 'feedback' ? 'feedback-row' : 'filled'} how-to-example-row`}
                      style={{ '--delay': '0ms' }}
                    >
                      <span className={`row-label ${row.type === 'feedback' ? 'retry-label' : ''}`}>
                        {row.label}
                      </span>
                      <div className="slots">
                        {Array.from(row.word).map((letter, letterIndex) => (
                          <span
                            key={`${row.word}-${letterIndex}`}
                            className={`slot typed ${
                              row.type === 'feedback' ? `feedback-${row.feedback[letterIndex]}` : ''
                            }`}
                          >
                            {letter}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="modal-close-button" onClick={dismissHowToModal} autoFocus>
                Let&apos;s Play
              </button>
            </div>
          </div>
        </div>
      )}

      {isScoreModalOpen && puzzle && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowScoreModal(false)}>
          <div
            className={`score-modal ${didWin ? 'score-modal-win' : 'score-modal-fail'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Final score"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{modalTitle}</h2>
            <p className="modal-outcome-line">{modalOutcomeText}</p>
            <p className="score-line">Final score: {finalScoreLength}</p>
            <p className="share-preview-line">{shareEmojiLine}</p>
            <div className="modal-actions">
              <button type="button" className="modal-close-button" onClick={shareResult}>
                Share
              </button>
              <button type="button" className="modal-close-button" onClick={() => setShowScoreModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
