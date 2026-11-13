document.addEventListener('DOMContentLoaded', () => {
    
    const tourStepContainer = document.getElementById('tour-step-container');
    const buttonsContainer = document.getElementById('buttons-container');
    const creationContainer = document.getElementById('creation-container');
    let currentStepIdx = 0;

    function isSafeLink(url) {
        return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
    }

    function renderInlineMarkdown(text) {
        const parts = text.split('`');
        return parts
            .map((part, index) => {
                if (index % 2 === 1) {
                    return `<code>${part}</code>`;
                }

                let result = part;

                result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
                    if (!isSafeLink(url)) {
                        return label;
                    }
                    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`;
                });

                result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
                result = result.replace(/\*(?!\*)([^*]+)\*/g, '<em>$1</em>');
                result = result.replace(/_(?!_)([^_]+)_/g, '<em>$1</em>');

                return result;
            })
            .join('');
    }

    function renderMarkdown(raw) {
        if (!raw) {
            return '';
        }

        const escaped = escapeHtml(raw);
        const segments = escaped.split(/```/);

        return segments
            .map((segment, index) => {
                if (index % 2 === 1) {
                    return `<pre><code>${segment.trim()}</code></pre>`;
                }

                const lines = segment.split('\n');
                let html = '';
                let inUl = false;
                let inOl = false;

                const closeLists = () => {
                    if (inUl) {
                        html += '</ul>';
                        inUl = false;
                    }
                    if (inOl) {
                        html += '</ol>';
                        inOl = false;
                    }
                };

                lines.forEach((line) => {
                    const trimmed = line.trim();

                    if (!trimmed) {
                        closeLists();
                        html += '<br>';
                        return;
                    }

                    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
                    if (headingMatch) {
                        closeLists();
                        const level = headingMatch[1].length;
                        html += `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
                        return;
                    }

                    const olMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
                    if (olMatch) {
                        if (!inOl) {
                            closeLists();
                            html += '<ol>';
                            inOl = true;
                        }
                        html += `<li>${renderInlineMarkdown(olMatch[2])}</li>`;
                        return;
                    }

                    const ulMatch = /^[-*]\s+(.*)$/.exec(trimmed);
                    if (ulMatch) {
                        if (!inUl) {
                            closeLists();
                            html += '<ul>';
                            inUl = true;
                        }
                        html += `<li>${renderInlineMarkdown(ulMatch[1])}</li>`;
                        return;
                    }

                    closeLists();
                    html += `<p>${renderInlineMarkdown(trimmed)}</p>`;
                });

                closeLists();
                return html;
            })
            .join('');
    }

    // Switch straight to an empty quiz page with its loading screen, so nothing
    // from an earlier page shows while the quiz is fetched.
    function enterQuizPage() {
        cleanupAskButton();
        document.querySelectorAll('.content.active').forEach(c => c.classList.remove('active'));
        const quizContainer = document.getElementById('quiz-container');
        if (quizContainer) quizContainer.innerHTML = '';
        const loading = document.getElementById('loading-quiz');
        if (loading) loading.style.display = 'flex';
        document.getElementById('quiz-content')?.classList.add('active');
    }

    function clearTourStepContent() {
        const tourStepContainer = document.getElementById('tour-step-container');
        if (tourStepContainer) {
            tourStepContainer.innerHTML = '';  // Clears the content
            tourStepContainer.style.display = 'none';  
        }
    }

    function questionItemHtml(question, answer) {
        if (window.tourIsGuided !== 1) {
            return `<li class="question-item"><p class="question-text">${escapeHtml(question)}</p></li>`;
        }
        return `<li class="question-item">
            <p class="question-text">${escapeHtml(question)}</p>
            ${answer
                ? `<p class="question-answer"><span class="question-label">Answer</span>${escapeHtml(answer)}</p>`
                : `<p class="question-pending">Not answered yet</p>`}
        </li>`;
    }

    function cleanupAskButton() {
        const askBtn = document.getElementById('ask-question-container');
        if (askBtn) {
            askBtn.remove();
        }
    }

    window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.command === 'restoreUser') {
            window.user = message.user; 
        }

        if (message.command === 'updateTourStep') {
            try{
                cleanupAskButton();

                const { step, startLine, endLine, content, buttons, showExit, totalSteps, tourId, questions, isGuided} = message;
                const currentStepNumber = step;
                const progressPercent = Math.round((currentStepNumber / totalSteps) * 100);
                window.tourData = { id: tourId };
                window.tourIsGuided = Number(isGuided);
                const renderedContent = renderMarkdown(content);
            
                // Clean old question modal if present
                document.getElementById('ask-question-container')?.remove();
            
                // Update tour step content
                tourStepContainer.innerHTML = `
                <div class="tour-step-top">
                    <span class="tour-step-count">Step ${currentStepNumber} of ${totalSteps}</span>
                    ${showExit ? '<button class="exit" id="exit-button" title="Leave the tour" aria-label="Leave the tour">×</button>' : ''}
                </div>
                <div class="progress-wrapper">
                    <div class="progress-bar-outer">
                        <div class="progress-bar-inner" style="width: ${progressPercent}%;"></div>
                    </div>
                </div>
                <p class="tour-step-lines">Lines ${startLine + 1}–${endLine + 1}</p>
                ${message.anchorWarning ? `
                    <p class="tour-step-anchor-warning" style="color:#E5A50A; font-size:0.9rem;">
                        ${message.anchorStatus === 'moved' ? '↪' : '⚠'} ${escapeHtml(message.anchorWarning)}
                    </p>
                ` : ''}
                <div class="tour-step-markdown">${renderedContent}</div>

                ${questions && questions.length > 0 ? `
                <div class="questions-container">
                    <p class="questions-heading">${window.tourIsGuided === 1 ? 'Your questions on this step' : 'Your notes on this step'}</p>
                    <ul>${questions.map(q => questionItemHtml(q.question, q.answer)).join('')}</ul>
                </div>
            ` : ''}

                <div class="tour-nav">
                    ${buttons.showBack ? '<button id="back-button" class="tour-cancel-button">Back</button>' : '<span></span>'}
                    ${buttons.showNext ? '<button id="next-button" class="tour-submit-button">Next</button>' : ''}
                    ${buttons.showComplete ? '<button id="complete-button" class="tour-submit-button">Complete</button>' : ''}
                </div>
            `;
            tourStepContainer.style.display = 'block';
            
            // --- Create the correct button: "Ask Question" or "Take Note" ---
            if (window.user?.role !== "expert") {
                const guided = window.tourIsGuided === 1;
                const askBtnWrapper = document.createElement('div');
                askBtnWrapper.id = 'ask-question-container';
                askBtnWrapper.innerHTML = `
                    <div id="ask-question-ui">
                        <button type="button" id="ask-question-button" title="${guided ? 'Ask a question' : 'Take a note'}" aria-expanded="false" aria-controls="question-modal">
                            <img src="${window.lacyLogoUri}" alt="Lacy Logo" class="ask-logo" />
                            <span class="speech-bubble">${guided ? 'Have a question?' : 'Take notes'}</span>
                        </button>
                        <div id="question-modal" hidden>
                            <textarea id="question-input" placeholder="${guided ? 'Type your question here...' : 'Write your note here...'}"></textarea>
                            <button type="button" id="send-question-button" disabled>${guided ? 'Send Question' : 'Save Note'}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(askBtnWrapper);

                const modal = document.getElementById('question-modal');
                const toggleBtn = document.getElementById('ask-question-button');
                const input = document.getElementById('question-input');
                const sendBtn = document.getElementById('send-question-button');
                const setOpen = (open) => {
                    modal.hidden = !open;
                    toggleBtn.setAttribute('aria-expanded', String(open));
                    if (open) input.focus();
                };
                const send = () => {
                    const questionText = input.value.trim();
                    const userId = window.user?.id;
                    const tourId = window.tourData?.id;
                    if (!questionText || !tourId || !userId) return;
                    input.value = '';
                    sendBtn.disabled = true;
                    setOpen(false);
                    vscode.postMessage({
                        command: 'submitQuestion',
                        question: questionText,
                        tourId: tourId,
                        userId: userId,
                        stepNo: currentStepNumber
                    });
                };
                toggleBtn.addEventListener('click', () => setOpen(modal.hidden));
                input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') { setOpen(false); toggleBtn.focus(); }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
                });
                sendBtn.addEventListener('click', send);
            }
            
                // Navigation buttons
                if (buttons.showBack) {
                    document.getElementById('back-button')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'prevStep' });
                    });
                }
                if (buttons.showNext) {
                    document.getElementById('next-button')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'nextStep' });
                    });
                }
                if (buttons.showComplete) {
                    document.getElementById('complete-button')?.addEventListener('click', () => {
                        window.__lacyQuizOpening = true;
                        enterQuizPage();
                        clearTourStepContent();
                        vscode.postMessage({ command: 'completeTour'  });
                    });
                }
                if (showExit) {
                    document.getElementById('exit-button')?.addEventListener('click', () => {
                        clearTourStepContent();
                        cleanupAskButton();
                        vscode.postMessage({ command: 'exitTour'});
                    });
                }
                }catch (error) {
                    console.error('Error in updateTourStep:', error);}
                
        }
        
        if (message.command === 'showQuiz') {
            if (!window.__lacyQuizOpening) enterQuizPage();
            window.__lacyQuizOpening = false;
            window.dispatchEvent(new CustomEvent('fetchQuizQuestionsEvent', {
                detail: { tourName: localStorage.getItem('selectedTourName') }
            }));
        }
        if (message.command === 'returnToMainPage') {
            cleanupAskButton();

            // Navigate back to the main tours page
            const lastType = localStorage.getItem('lastTourType');
            localStorage.removeItem('lastTourType');

            if (lastType === 'exploration') {
                document.getElementById('tours-tab')?.click();
                return;
            } else {
                document.getElementById('my-tours-tab')?.click();
            }

            document.getElementById('ask-question-container')?.remove();

        }

        if (message.command === 'questionFailed') {
            // The extension already shows the error; just re-enable the form.
            const askInput = document.getElementById('question-input');
            const askButton = document.getElementById('submit-question-button');
            if (askInput) askInput.disabled = false;
            if (askButton) askButton.disabled = false;
        }

        if(message.command === 'questionSubmitted') {
            let questionsContainer = tourStepContainer.querySelector('.questions-container');
            if (!questionsContainer) {
                questionsContainer = document.createElement('div');
                questionsContainer.className = 'questions-container';
                questionsContainer.innerHTML = `<p class="questions-heading">${window.tourIsGuided === 1 ? 'Your questions on this step' : 'Your notes on this step'}</p><ul></ul>`;
                const nav = tourStepContainer.querySelector('.tour-nav');
                if (nav) nav.before(questionsContainer); else tourStepContainer.appendChild(questionsContainer);
            }
            questionsContainer.querySelector('ul').insertAdjacentHTML('beforeend', questionItemHtml(message.question, null));
            showToast(window.tourIsGuided === 1 ? 'Question sent' : 'Note saved');
        }
        if (message.command === 'questionFailed') {
            showToast(`Failed to submit question: ${message.error || 'Unknown error'}`);
        }
    });    
});

function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = 'lacy-toast';
    toast.setAttribute('role', 'status');

    document.body.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 10);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
