/**
 * Turning a name written for a map into one that fits a flight board.
 *
 * OpenStreetMap names things the way a cartographer would — "Frankfurt Airport",
 * "Terminal 1" — while the platform shows them in a column a few characters
 * wide. These rules only ever shorten what OSM already says: a name they do not
 * recognise is handed on whole rather than guessed at.
 */

/** The API's cap on a terminal short name; `uniqueShortName` disambiguates inside it. */
const MAX_SHORT_NAME_LENGTH = 8;

const AIRPORT_SUFFIX = /^(.+?)(\s+International)?\s+Airport$/i;

/** All that is left of a name that was only ever the generic words. */
const NOTHING_BUT_GENERIC = /^international$/i;

const TERMINAL_DESIGNATOR = /^terminal\s+(\S+)$/i;

/**
 * "Venice Marco Polo International Airport" becomes "Venice Marco Polo Intl" and
 * "Frankfurt Airport" becomes "Frankfurt": in a list of airports the word itself
 * carries nothing. An aerodrome OpenStreetMap names by nothing but those generic
 * words keeps them, since stripping them would leave no name at all.
 */
export function shortenAirportName(name: string): string {
  const trimmed = name.trim();
  const match = AIRPORT_SUFFIX.exec(trimmed);

  if (!match || NOTHING_BUT_GENERIC.test(match[1])) {
    return trimmed;
  }

  return match[2] ? `${match[1]} Intl` : match[1];
}

/**
 * "Terminal 1" is "T1", "Terminal A" is "A". The number keeps its T because a
 * bare "1" reads as nothing next to a stand designator, the letter does not
 * because that letter is already how the airport signposts the pier. Anything
 * more elaborate — "Terminal 1A", "Terminal North" — is left to the rules below.
 */
function designatorShortName(name: string): string | undefined {
  const match = TERMINAL_DESIGNATOR.exec(name.trim());

  if (!match) {
    return undefined;
  }

  const designator = match[1];

  if (/^\p{L}$/u.test(designator)) {
    return designator.toUpperCase();
  }

  if (/^\d+$/.test(designator)) {
    const shortName = `T${designator}`;

    return shortName.length <= MAX_SHORT_NAME_LENGTH ? shortName : undefined;
  }

  return undefined;
}

function compactName(name: string): string {
  const compact = name
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((token) => (/\d/.test(token) ? token : token[0]))
    .join("");

  return compact.toUpperCase().slice(0, MAX_SHORT_NAME_LENGTH) || "T";
}

/**
 * A recognised "Terminal <designator>" name wins over `ref`, because a mapper who
 * tagged both usually wrote `ref=1` beside `name=Terminal 1`, and "T1" is the one
 * an operator reads. Everything else falls back to `ref`, then to initials.
 */
export function deriveTerminalShortName(ref: string, name: string): string {
  const designator = designatorShortName(name);

  if (designator) {
    return designator;
  }

  if (ref) {
    const code = ref
      .split(/[;,/]/)[0]
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, MAX_SHORT_NAME_LENGTH);

    if (code) {
      return code;
    }
  }

  return compactName(name);
}

export function uniqueShortName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = base.slice(0, MAX_SHORT_NAME_LENGTH - String(suffix).length) + suffix;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return base;
}
