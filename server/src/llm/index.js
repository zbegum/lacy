// LLM access behind one function, so tour, quiz and podcast generation do not
// care which provider is configured.
//
// Providers:
//   gemini - Google Gemini (GEMINI_API_KEY)
//   openai - any OpenAI-compatible /chat/completions endpoint: OpenAI, Azure OpenAI
//            proxies, vLLM, Ollama, LM Studio, a company LLM gateway, ...
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { llm } = require('../config');
const { requireAi, NotConfiguredError } = require('../setup');

let geminiModel;

async function generateWithGemini(prompt) {
    if (!llm.gemini.apiKey) {
        throw new Error('GEMINI_API_KEY is not set.');
    }
    if (!geminiModel) {
        geminiModel = new GoogleGenerativeAI(llm.gemini.apiKey).getGenerativeModel({ model: llm.gemini.model });
    }
    let result;
    try {
        result = await geminiModel.generateContent(prompt);
    } catch (err) {
        // A retired or misspelt model: retrying will not help, the setting has to change.
        if (err.status === 404 || /\[404 /.test(err.message)) {
            throw new NotConfiguredError('ai',
                `The AI model "${llm.gemini.model}" is not available to this Lacy server's Gemini key `
                + '(Google may have retired it). Ask whoever runs the server to set GEMINI_MODEL, '
                + 'for example to gemini-flash-latest.');
        }
        throw err;
    }
    const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini returned an empty response.');
    }
    return text;
}

async function generateWithOpenAI(prompt) {
    const { baseUrl, apiKey, model } = llm.openai;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`LLM endpoint returned ${response.status}: ${body.slice(0, 500)}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
        throw new Error('LLM endpoint returned an empty response.');
    }
    return text;
}

const providers = {
    gemini: generateWithGemini,
    openai: generateWithOpenAI,
};

// The sidebar sends the model the user picked. Unknown values (including model
// names from older versions of the extension) fall back to the server default.
function resolveProvider(requested) {
    const key = String(requested || '').toLowerCase();
    return providers[key] ? key : llm.provider;
}

async function generateText(prompt, requestedProvider) {
    const provider = resolveProvider(requestedProvider);
    requireAi(provider);
    const generate = providers[provider];
    if (!generate) {
        throw new Error(`Unsupported LLM_PROVIDER "${provider}". Use gemini or openai.`);
    }
    return generate(prompt);
}

// Pull the first JSON array/object out of an LLM reply that may be wrapped in
// markdown fences or surrounded by prose.
function extractJson(text) {
    const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
    const starts = [cleaned.indexOf('['), cleaned.indexOf('{')].filter((i) => i !== -1);
    if (starts.length === 0) {
        throw new Error('LLM response does not contain JSON.');
    }
    const start = Math.min(...starts);
    const end = cleaned.lastIndexOf(cleaned[start] === '[' ? ']' : '}');
    if (end <= start) {
        throw new Error('LLM response contains incomplete JSON.');
    }
    return JSON.parse(cleaned.slice(start, end + 1));
}

module.exports = { generateText, extractJson, resolveProvider };
