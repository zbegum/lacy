/**
 * Keeping a tour step pointing at the right code.
 *
 * A step is stored as a file path and a line range, which drifts as soon as
 * anyone edits above it — or when the reader is on a different branch. So the
 * text of those lines is stored with the step, and when the step is opened the
 * code is found by content rather than trusted by line number.
 */

/** How much of the step's code is remembered. Enough to identify it, not the whole file. */
const MAX_ANCHOR_CHARS = 4000;

export type AnchorStatus = 'exact' | 'moved' | 'changed' | 'missing' | 'unknown';

/** Below this share of matching content, the code is treated as gone rather than edited. */
const CHANGED_THRESHOLD = 0.65;

export interface LocatedStep {
    startLine: number;   // 1-based, inclusive
    endLine: number;     // 1-based, inclusive
    status: AnchorStatus;
}

/** The text a step should remember, taken from the file it was created against. */
export function anchorTextFor(fileContent: string, startLine: number, endLine: number): string | null {
    if (!fileContent || !startLine || !endLine || endLine < startLine) return null;
    const text = fileContent.split('\n').slice(startLine - 1, endLine).join('\n');
    return text.trim() ? text.slice(0, MAX_ANCHOR_CHARS) : null;
}

const normalise = (line: string) => line.replace(/\s+/g, ' ').trim();

const tokens = (line: string) => normalise(line).split(/[^\w$]+/).filter(Boolean);

/** How much two lines have in common, 0 to 1, by shared tokens. */
function lineSimilarity(a: string, b: string): number {
    if (normalise(a) === normalise(b)) return 1;
    const left = tokens(a);
    const right = new Set(tokens(b));
    if (left.length === 0 || right.size === 0) return 0;
    const shared = left.filter((t) => right.has(t)).length;
    return shared / Math.max(left.length, right.size);
}

/**
 * How much of the remembered block still matches the file at this offset.
 * Lines are weighted by how much they actually say, so a file full of closing
 * braces cannot make unrelated code look like a match.
 */
function blockSimilarity(fileLines: string[], anchorLines: string[], at: number): number {
    if (at < 0 || at >= fileLines.length) return 0;
    let score = 0;
    let weight = 0;
    for (let i = 0; i < anchorLines.length; i++) {
        const lineWeight = tokens(anchorLines[i]).length;
        if (lineWeight === 0) continue; // blank lines, lone braces
        weight += lineWeight;
        const fileLine = fileLines[at + i];
        if (fileLine === undefined) continue;
        score += lineSimilarity(anchorLines[i], fileLine) * lineWeight;
    }
    return weight === 0 ? 0 : score / weight;
}

function blockMatches(fileLines: string[], anchorLines: string[], at: number): boolean {
    if (at < 0 || at + anchorLines.length > fileLines.length) return false;
    return anchorLines.every((line, i) => normalise(fileLines[at + i]) === normalise(line));
}

/**
 * Find a step's code in the file as it is now.
 *
 * - `exact`   the code is where the step says it is
 * - `moved`   the same code was found elsewhere, and the range follows it
 * - `changed` recognisably the same code, but edited since the tour was written
 * - `missing` the code is not in this file any more; the original range is
 *             returned so something can still be shown, flagged as missing
 * - `unknown` the step predates anchoring, so line numbers are all there is
 */
export function locateStep(
    fileContent: string,
    anchorText: string | null | undefined,
    startLine: number,
    endLine: number,
): LocatedStep {
    const original = { startLine, endLine };
    if (!anchorText || !anchorText.trim()) {
        return { ...original, status: 'unknown' };
    }

    const fileLines = fileContent.split('\n');
    // Ignore blank lines at either end; they move about and carry no meaning. But
    // remember how many led the block: the code itself starts that many lines
    // after startLine, and looking for it at startLine would call it "moved".
    const allLines = anchorText.split('\n');
    let leading = 0;
    while (leading < allLines.length && allLines[leading].trim() === '') leading++;
    let trailing = allLines.length;
    while (trailing > leading && allLines[trailing - 1].trim() === '') trailing--;
    const anchorLines = allLines.slice(leading, trailing);
    if (anchorLines.length === 0) {
        return { ...original, status: 'unknown' };
    }

    const span = endLine - startLine;
    const expectedAt = startLine - 1 + leading;
    if (blockMatches(fileLines, anchorLines, expectedAt)) {
        return { startLine, endLine: startLine + Math.max(span, leading + anchorLines.length - 1), status: 'exact' };
    }

    // Look outwards from where the step used to be: the nearest copy is the
    // likeliest one when the same snippet appears more than once.
    const candidates: number[] = [];
    for (let i = 0; i + anchorLines.length <= fileLines.length; i++) {
        if (blockMatches(fileLines, anchorLines, i)) candidates.push(i);
    }
    if (candidates.length > 0) {
        const best = candidates.reduce((a, b) =>
            Math.abs(a - expectedAt) <= Math.abs(b - expectedAt) ? a : b);
        return {
            startLine: best + 1,
            endLine: best + anchorLines.length,
            status: 'moved',
        };
    }

    // Nothing matches exactly. The code was probably edited rather than removed,
    // so find the closest remaining match and say it has changed.
    let best = { at: -1, score: 0 };
    for (let i = 0; i + 1 <= fileLines.length; i++) {
        const score = blockSimilarity(fileLines, anchorLines, i);
        if (score > best.score) best = { at: i, score };
    }

    if (best.at !== -1 && best.score >= CHANGED_THRESHOLD) {
        return {
            startLine: best.at + 1,
            endLine: Math.min(best.at + anchorLines.length, fileLines.length),
            status: 'changed',
        };
    }

    return { ...original, status: 'missing' };
}

/** What to tell the reader when a step no longer matches the code. */
export function anchorWarning(status: AnchorStatus, filePath: string): string | null {
    if (status === 'moved') {
        return `This step's code has moved in ${filePath}; Lacy followed it to its current position.`;
    }
    if (status === 'changed') {
        return `This step's code in ${filePath} has been edited since the tour was written, `
            + 'so the description may no longer match it exactly.';
    }
    if (status === 'missing') {
        return `This step's code is no longer in ${filePath} — it may have been changed on this branch `
            + 'since the tour was written. The highlighted lines may not be the right ones.';
    }
    return null;
}
