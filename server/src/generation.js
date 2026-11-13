// LLM-backed generation of tour steps, tour names and quiz questions.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { generateText, extractJson } = require('./llm');
const {
    buildCodebaseTourPrompt,
    buildTourNamePrompt,
    buildQuizQuestionsPrompt,
    buildPodcastScriptPrompt,
} = require('./llm/prompts');

/**
 * Collect the source code a tour is generated from.
 *
 * The extension sends file contents with the request (`fileContents`, keyed by
 * project-relative path), so the server never needs access to the developer's
 * disk. Reading from disk is only a fallback for local setups that enable
 * ALLOW_LOCAL_FILE_ACCESS.
 *
 * @returns {{ path: string, lines: string[], parts: {start:number,end:number,description?:string}[] | null }[]}
 */
function loadSources({ files = [], fileParts = {}, fileContents = {}, basePath, projectName }) {
    return files.map((relativePath) => {
        let content = fileContents[relativePath];
        if (content === undefined && config.allowLocalFileAccess && basePath && projectName) {
            const root = path.resolve(basePath, projectName);
            const absolute = path.resolve(root, relativePath);
            if (absolute.startsWith(root + path.sep)) {
                try {
                    content = fs.readFileSync(absolute, 'utf8');
                } catch (err) {
                    console.error(`Could not read ${absolute}: ${err.message}`);
                }
            }
        }
        const parts = fileParts[relativePath];
        return {
            path: relativePath,
            lines: content === undefined ? null : content.split('\n'),
            parts: Array.isArray(parts) && parts.length ? parts : null,
        };
    }).filter((source) => {
        if (!source.lines) console.warn(`No content for ${source.path}; skipping it.`);
        return source.lines;
    });
}

function numbered(lines) {
    return lines.map((line, idx) => `${idx + 1} | ${line}`).join('\n');
}

function excerpt(lines, part) {
    return lines.slice(part.start - 1, part.end).join('\n');
}

function formatForTour(sources) {
    return sources.map(({ path: file, lines, parts }) => {
        if (!parts) {
            return `\n### FILE: ${file}\nSTART OF FILE:\n"\n${numbered(lines)}\n"\nEND OF FILE\n`;
        }
        return parts.map((part) =>
            `\n### PARTIAL FILE: ${file}\nPart from line ${part.start} to ${part.end}:\n"\n${excerpt(lines, part)}\n"\nEND OF PARTIAL\n`
        ).join('');
    }).join('');
}

function formatForQuiz(sources) {
    return sources.map(({ path: file, lines, parts }) => {
        if (!parts) {
            return `\n### File: ${file}\n\`\`\`\n${numbered(lines)}\n\`\`\`\n`;
        }
        return `\n### DEFINITELY INCLUDE THE FOLLOWING PART(S) OF FILE: ${file}\n` + parts.map((part) =>
            `--- Part from line ${part.start} to ${part.end}\n` +
            (part.description ? `// Description: ${part.description}\n` : '') +
            `\`\`\`\n${excerpt(lines, part)}\n\`\`\`\n`
        ).join('');
    }).join('');
}

async function generateTourSteps({ sources, llmModel, tourFocus, projectKnowledge, targetDepartment, description, language }) {
    const prompt = buildCodebaseTourPrompt({
        tour_focus: tourFocus,
        projectKnowledge,
        target_audience: targetDepartment,
        fileSummaryList: sources.map((s) => `- ${s.path}`).join('\n'),
        fileContents: formatForTour(sources),
        description,
        language,
    });
    const steps = extractJson(await generateText(prompt, llmModel));
    if (!Array.isArray(steps)) {
        throw new Error('Expected the LLM to return a JSON array of tour steps.');
    }
    return steps.map((step, idx) => ({
        step_number: Number(step.step_number) || idx + 1,
        description: String(step.description || '').trim(),
        file_path: step.file_path ? String(step.file_path).trim() : null,
        line_start: Number(step.line_start) || null,
        line_end: Number(step.line_end) || null,
    }));
}

async function generateTourName({ files, llmModel, tourFocus, projectKnowledge, projectName, language }) {
    const prompt = buildTourNamePrompt({
        tour_focus: tourFocus,
        projectKnowledge,
        projectName,
        fileList: files.map((f) => path.basename(f)).join(', '),
        randomizer: Math.floor(Math.random() * 10000),
        language,
    });
    const text = await generateText(prompt, llmModel);
    return text.trim().replace(/^"|"$/g, '') || 'Self-Guided Tour';
}

function stripHtmlTags(value) {
    if (value == null) return '';
    const s = String(value);
    const img = s.match(/<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/i);
    if (img && img[1]) return img[1];
    return s.replace(/<[^>]*>/g, '').trim();
}

function toStringArray(value) {
    if (Array.isArray(value)) return value.map(stripHtmlTags).filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(stripHtmlTags).filter(Boolean);
        } catch {
            // not JSON; treat as comma-separated
        }
        return value.split(/\s*,\s*/).map(stripHtmlTags).filter(Boolean);
    }
    return [stripHtmlTags(value)].filter(Boolean);
}

async function generateQuizQuestions({ sources, llmModel, tourFocus, projectKnowledge, targetDepartment, language, numQuestions = 5 }) {
    const prompt = buildQuizQuestionsPrompt({
        numQuestions,
        tour_focus: tourFocus,
        projectKnowledge,
        targetDepartment,
        fileContents: formatForQuiz(sources),
        language,
    });
    const parsed = extractJson(await generateText(prompt, llmModel));
    if (!Array.isArray(parsed)) {
        throw new Error('Expected the LLM to return a JSON array of quiz questions.');
    }

    return parsed.map((q, idx) => {
        const options = [...new Set(toStringArray(q.options || q.opts || q.option || []))];
        const answers = [...new Set(toStringArray(q.answers || q.answer || []))];
        answers.forEach((a) => { if (!options.includes(a)) options.push(a); });

        let questionType = String(q.question_type || q.type || '').toLowerCase();
        if (questionType !== 'radio' && questionType !== 'checkbox') {
            questionType = answers.length > 1 ? 'checkbox' : 'radio';
        }
        const score = Number(q.score) > 0 ? Number(q.score) : 1;

        return {
            question_id: Number(q.question_id) || idx + 1,
            question: q?.question ? String(q.question).trim() : '',
            question_type: questionType,
            options,
            answers,
            score,
        };
    })
        .filter((q) => q.question && q.options.length > 0 && q.answers.length > 0)
        .slice(0, numQuestions);
}

async function generatePodcastScript({ sources, llmModel }) {
    return generateText(buildPodcastScriptPrompt({ fileContents: formatForQuiz(sources) }), llmModel);
}

/** The lines a generated step covers, remembered so the step can be found later. */
function anchorTextForStep(sources, filePath, startLine, endLine) {
    if (!filePath || !startLine || !endLine || endLine < startLine) return null;
    const normalised = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    const source = sources.find((s) => s.path === normalised || normalised.endsWith(`/${s.path}`) || s.path.endsWith(`/${normalised}`));
    if (!source) return null;
    const text = source.lines.slice(startLine - 1, endLine).join('\n');
    return text.trim() ? text.slice(0, 4000) : null;
}

module.exports = {
    anchorTextForStep,
    loadSources,
    generateTourSteps,
    generateTourName,
    generateQuizQuestions,
    generatePodcastScript,
};
