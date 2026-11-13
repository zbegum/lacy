/** The "Loading your quiz…" screen, taken down on every way out of loading. */
function hideQuizLoading() {
    const overlay = document.getElementById('loading-quiz');
    if (overlay) overlay.style.display = 'none';
}

// After grading: the right answer you picked, a wrong one you picked, and a right
// one you missed. Classes rather than inline colours, so the panel's styles (with
// a label, not only a colour) decide how each one looks.
function markResult(option, isCorrect, isSelected) {
    option.classList.remove('result-correct', 'result-incorrect', 'result-missed');
    if (isCorrect && isSelected) option.classList.add('result-correct');
    else if (isCorrect) option.classList.add('result-missed');
    else if (isSelected) option.classList.add('result-incorrect');
}

document.addEventListener("DOMContentLoaded", function () {
    // Listen for messages from the extension
    window.addEventListener('fetchQuizQuestionsEvent', event => {
        let { tourName } = event.detail;

        if (tourName == undefined) {
            tourName = localStorage.getItem('selectedTourName');
        }
        fetchQuizQuestions(tourName);
    });

    const quizContainer = document.getElementById('quiz-container');
    let quizStartTime = null;
    let quizEndTime = null;

    // Helper: ensure a value is an array of strings. Accepts arrays, JSON-encoded strings, single values or null.
    function normalizeArrayField(val) {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                // not JSON, return the string as single-element array
                return [val];
            }
        }
        if (val == null) return [];
        return [val];
    }

    // Helper: escape text for safe insertion into HTML templates

    async function getTourId(tourName) {
        const decodedTourName = decodeURIComponent(tourName);
    
        try {
            const response = await fetch(`${window.LACY_API_URL}/api/get-tour-id?tourName=${encodeURIComponent(decodedTourName)}`);
            if (response.ok) {
                const data = await response.json();
                return data; // Return both tour_id and isGuided
            } else {
                return null;
            }
        } catch (error) {
            return null;
        }
    }
    // Function to fetch quiz questions
    async function fetchQuizQuestions(tourName) {
        const decodedTourName =tourName;
        // Post data to the API
        quizContainer.innerHTML = '';
        document.getElementById('loading-quiz').style.display = 'flex';
        const response = await getTourId(tourName);
        if (!response || !response.tour_id) {
            document.getElementById('loading-quiz').style.display = 'none';
            vscode.postMessage({
                command: 'showError',
                text: 'Could not load this quiz. Please check that the Lacy server is running.'
            });
            return;
        }
        const { tour_id: tourID, isGuided, user_id: creatorId } = response;
        document.getElementById('loading-quiz').style.display = 'flex';

        const state = vscode.getState();
        const user = state?.user;
        

        if (!user) {
            hideQuizLoading();
            return;
        }
    
        const isQuiz = await fetch (`${window.LACY_API_URL}/api/get-quiz?tour_id=${tourID}`);
        const quizData = await isQuiz.json();
        if (!Array.isArray(quizData) || quizData.length === 0) {
            // No quiz for this tour: straight on to feedback, without the loading screen.
            hideQuizLoading();
            /*if (!isGuided) {
                vscode.postMessage({ command: 'feedbackCompleted' }); // Send message to transition to tours main page
                return;
            }*/
            // Finishing a tour that has no quiz still finishes it.
            try {
                await fetch(`${window.LACY_API_URL}/api/complete-tour`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tourID }),
                });
            } catch (err) {
                console.error('Could not record the tour as completed:', err);
            }
            // The extension clears the step highlights and sends back renderFeedbackPage.
            vscode.postMessage({ command: 'completeQuiz', tourName: decodedTourName });
            return;
        }
        //TO DO:checkin if user is assigned to the tour
        // WRONGLY THINKS THE TOUR IS NOT SOLVED WHEN IT IS NOT ASSIGNED
     
            let isQuizSolved;
            try {
                const response = await fetch(`${window.LACY_API_URL}/api/get-quiz-score?learner_id=${user.id}&tour_id=${tourID}`);
                if (response.ok) {
                    const data = await response.json();
                    // Check if the quiz is solved based on the presence of a score
                    isQuizSolved = data.isSolved ;
                    if (user.id == creatorId && isGuided) {
                        renderCreatorQuiz(user.id, tourID, decodedTourName);
                    }
                    else if (isQuizSolved) {
                        renderSolvedQuiz(user.id, tourID, decodedTourName, data.total_score);
                    }
                    else {
                        renderFirstQuiz(user.id, tourID, decodedTourName);
                    }
                    return; // Exit early since the quiz is already solved
                }
            } catch (error) {
            console.error('Unexpected error:', error);
        }
        // The score check failed or errored: do not leave the loading screen up.
        hideQuizLoading();
    }
    async function renderCreatorQuiz(userId, tourId, decodedTourName) {
        const quizContainer = document.getElementById('quiz-container');
    
        if (!decodedTourName) {
            return;
        }
    
        document.getElementById('loading-quiz').style.display = 'none';
    
        try {
            // Fetch quiz questions from the API
            const questionsResponse = await fetch(`${window.LACY_API_URL}/api/get-quiz-questions?tourName=${encodeURIComponent(decodedTourName)}`);
            let quizQuestions = await questionsResponse.json();
            // Normalize options/answers to arrays (some DB rows store them as JSON strings)
            quizQuestions = quizQuestions.map(q => ({
                ...q,
                options: normalizeArrayField(q.options),
                answers: normalizeArrayField(q.answers)
            }));
    
            if (!quizQuestions || quizQuestions.length === 0) {
                hideQuizLoading();
                document.getElementById('my-tours-tab')?.click(); // Redirect to the tours tab
                return;
            }
    
            // Render the quiz with answers visible
                if (quizContainer) {
                quizContainer.innerHTML = `
                    <div id="quiz-container">
                        <h1 class="quiz-title">${escapeHtml(decodedTourName)}</h1>
                        <p class="tour-form-method"><strong>Answer key</strong> · What learners are asked, with the correct answers marked.</p>
                        ${quizQuestions.map((question, index) => {
                            const options = normalizeArrayField(question.options);
                            const correctAnswers = (question.answers || []).map(ans => ans.toLowerCase()); 
                            return `
                                <div class="quiz-question" data-type="${question.question_type}" data-index="${index}">
                                    <h3 class="question-text">${escapeHtml(question.question)}</h3>
                                    <div class="quiz-answers">
                                        ${question.question_type === 'text' ? `
                                            <div class="quiz-option text-option result-key">${escapeHtml((question.answers || [])[0] || '')}</div>
                                        ` : `
                                            ${options.map(option => {
                                                const isCorrect = correctAnswers.includes(option.toLowerCase());
                                                return `
                                                    <div class="quiz-option ${question.question_type}-option ${isCorrect ? 'correct result-key' : ''}">${escapeHtml(option)}</div>
                                                `;
                                            }).join('')}
                                        `}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        <button id="return-to-tours" class="return-button">Back to My Tours</button>
                    </div>
                `;
            }
    
            attachReturnToToursButton();
        } catch (error) {
            quizContainer.innerHTML = `
                <div class="quiz-container">
                    <p style="color: red;">An error occurred while loading the quiz. Please try again later.</p>
                    <button id="return-to-tours" class="return-button">Return to Tours Tab</button>
                </div>`;
            attachReturnToToursButton();
        }
    }
    function attachReturnToToursButton() {
        const returnToToursButton = document.getElementById("return-to-tours");
        if (returnToToursButton) {
            returnToToursButton.addEventListener("click", function () {
                document.getElementById('my-tours-tab')?.click(); // Redirect to the tours tab
            });
        }
    }
    async function renderFirstQuiz(userID, tourID, decodedTourName) {
        let quizQuestions = [];
        try {
            const response = await fetch(`${window.LACY_API_URL}/api/get-quiz-questions?tourName=${encodeURIComponent(decodedTourName)}`);
                if (response.ok) {
                quizQuestions = await response.json();
                // Normalize options/answers to arrays to avoid .map errors when server returns JSON strings
                quizQuestions = quizQuestions.map(q => ({
                    ...q,
                    options: normalizeArrayField(q.options),
                    answers: normalizeArrayField(q.answers)
                }));
            }
        } catch (error) {
            console.error('Unexpected error:', error);
        }
        // Verify the server response
        document.getElementById('loading-quiz').style.display = 'none';
        // Define correct answers and scores (this should be fetched from the server as well)
        const correctAnswers = quizQuestions.map(q => q.answers);
        const scores = quizQuestions.map(q => q.score);
        const totalMaxScore = scores.reduce((acc, score) => acc + score, 0);
       
        if (!quizQuestions || quizQuestions.length === 0) {
            if (quizContainer) {
                if(localStorage.getItem('lastTourType' ) === 'exploration'){
                    document.getElementById('my-tours-tab')?.click();
                }
                vscode.postMessage({ command: 'completeQuiz', tourName: decodedTourName });
            }
            if(localStorage.getItem('lastTourType' ) === 'guided'){
                const completeResponse = await fetch(`${window.LACY_API_URL}/api/complete-tour`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userID,
                        tourID
                    })
                });
                
                const result = await completeResponse.json();
            }
            return; // Stop further execution
        }
       
        if (quizContainer) {
            quizStartTime = new Date(); // Record the start time
            const projectName = localStorage.getItem('selectedTourName');

            quizContainer.innerHTML = `
                <h2 class="quiz-title">${projectName} Quiz</h2>
                ${quizQuestions.map((question, index) => {
                    const options = normalizeArrayField(question.options);
                    return `
                        <div class="quiz-question" data-type="${question.question_type}" data-index="${index}">
                            <h3 class="question-text">${escapeHtml(question.question)}</h3>
                            <p class="question-score" style="color: #ccc; font-size: 0.9rem; margin-top: 5px;">
                                Score: ${question.score}
                            </p>
                            ${question.question_type === 'checkbox' ? `
                                <p class="multiple-answers-note" style="color: white; font-size: 0.9rem; margin-top: 5px;">
                                    For full credit you need to choose all correct options and none of the incorrect options. No partial credit will be given.
                                </p>
                            ` : ''}
                            <div class="quiz-answers">
                                    ${question.question_type === 'text' ? `
                                    <input type="text" class="quiz-option text ungraded" value="" placeholder="Type your answer here">
                                ` : `
                                    ${options.map(option => `
                                        <div class="quiz-option ${question.question_type}-option ungraded">
                                            ${escapeHtml(option)}
                                        </div>
                                    `).join('')}
                                `}
                            </div>
                        </div>
                    `;
                }).join('')}
                <div id="validation-message" class="validation-message"></div>
                <div id="score-container" style="display:none" class="score-container"></div>
                <button id="finish-quiz">Finish Quiz</button>
            `;
        }
        document.querySelectorAll(".quiz-question").forEach(question => {
            const questionType = question.dataset.type;
        
            if (questionType === "radio") {
                question.querySelectorAll(".quiz-option").forEach(option => {
                    option.addEventListener("click", function () {
        
                        // Deselect all other options in the same question
                        question.querySelectorAll(".quiz-option").forEach(opt => opt.classList.remove("selected"));
        
                        // Select the clicked option
                        this.classList.add("selected");
        
                        // Validate the question after updating the selected state
                        validateQuestion(question);
                    });
                });
            } else if (questionType === "checkbox") {
                question.querySelectorAll(".quiz-option").forEach(option => {
                    option.addEventListener("click", function () {
        
                        // Toggle the 'selected' class
                        if (this.classList.contains("selected")) {
                            this.classList.remove("selected");
                        } else {
                            this.classList.add("selected");
                        }
        
                        // Validate the question after updating the selected state
                        validateQuestion(question);
                    });
                });
            } else if (questionType === "text") {
                const input = question.querySelector("input");
                input.addEventListener("input", () => {
                    validateQuestion(question); // Validate the question when the user types
                });
            }
        });
  
        const finishQuizBtn = document.getElementById("finish-quiz")

        // Handle quiz submission
        if (finishQuizBtn) {
            let quizSubmitted = false;
            finishQuizBtn.addEventListener("click", async function () {
                // Once graded, the same button moves on to feedback.
                if (quizSubmitted) {
                    finishQuizBtn.disabled = true;
                    vscode.postMessage({ command: 'completeQuiz', tourName: decodedTourName });
                    return;
                }
                let isValid = true; // Flag to track if all questions are answered
                const userAnswers = [];
                const unansweredQuestions = []; // To track unanswered questions
            
                // Clear any previous validation messages
                const validationMessage = document.getElementById("validation-message");
                validationMessage.textContent = ""; // Clear the message
                validationMessage.style.display = "none"; // Hide the message initially
                // Validate each question
                document.querySelectorAll(".quiz-question").forEach((question, index) => {
                    const questionType = question.dataset.type;
                    const selectedOptions = question.querySelectorAll(".quiz-option.selected");
                    const userAnswer = question.querySelector("input")?.value.trim(); // For text questions
            
                    if (questionType === "radio" || questionType === "checkbox") {
                        // Check if at least one option is selected
                        if (selectedOptions.length === 0) {
                            
                            isValid = false; // No option selected
                            unansweredQuestions.push(index + 1); // Add question number to the list
                            question.querySelector(".quiz-answers").style.border = "2px solid red"; // Highlight the unanswered question
                        } else {
                            userAnswers.push(Array.from(selectedOptions).map(option => option.textContent.trim()));
                        }
                    } else if (questionType === "text") {
                        // Check if the text input is not empty
                        if (!userAnswer) {
                            isValid = false; // Text input is empty
                            unansweredQuestions.push(index + 1); // Add question number to the list
                            question.querySelector("input").style.border = "2px solid red"; // Highlight the unanswered question
                        } else {
                            userAnswers.push([userAnswer]);
                        }
                    }
                });
            
                // If any question is unanswered, display the validation message
                if (!isValid) {
                    validationMessage.textContent = `Please answer all questions before submitting the quiz. Unanswered questions: ${unansweredQuestions.join(', ')}`;
                    validationMessage.style.display = "block"; // Show the message
                    validationMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return; // Stop quiz submission if validation fails
                }
            
                // Grade only once, however many times the button is clicked.
                quizSubmitted = true;
                finishQuizBtn.disabled = true;
                document.querySelectorAll(".quiz-answers, .quiz-question input").forEach(el => { el.style.border = ""; });

                // Record quiz end time
                quizEndTime = new Date();
            
                // Calculate total score
                let totalScore = 0;
                document.querySelectorAll(".quiz-question").forEach((question, index) => {
                    const selectedOptions = question.querySelectorAll(".quiz-option.selected");
                    const textInput = question.querySelector("input.quiz-option.text");
                    const selectedValues = textInput
                        ? [textInput.value.trim()]
                        : Array.from(selectedOptions).map(option => option.textContent.trim());
                    const correctValues = correctAnswers[index];
                    const questionScore = scores[index];
                
                    if (question.dataset.type === "checkbox") {
                        // Calculate partial credit for checkbox questions
                        const correctSelected = selectedValues.filter(value => correctValues.includes(value)).length;
                        const incorrectSelected = selectedValues.filter(value => !correctValues.includes(value)).length;
                
                        const isFullyCorrect = correctSelected === correctValues.length && incorrectSelected === 0;
                        const finalScore = isFullyCorrect ? questionScore : 0;
                        totalScore += finalScore;
                
                        // Highlight correct and incorrect options
                        question.querySelectorAll(".quiz-option").forEach(option => {
                            markResult(option, correctValues.includes(option.textContent.trim()), option.classList.contains("selected"));
                        });
                    } else if (question.dataset.type === "radio") {
                        // Handle radio questions
                        selectedOptions.forEach(option => {
                            if (correctValues.includes(option.textContent.trim())) {
                                totalScore += questionScore;
                            }
                        });
                        question.querySelectorAll(".quiz-option").forEach(option => {
                            markResult(option, correctValues.includes(option.textContent.trim()), option.classList.contains("selected"));
                        });
                    } else if (question.dataset.type === "text") {
                        // Handle text questions: free text, so ignore case and padding.
                        const userAnswer = (selectedValues[0] || "").trim().toLowerCase();
                        const isCorrect = correctValues.some(v => String(v).trim().toLowerCase() === userAnswer);
                        if (userAnswer && isCorrect) {
                            totalScore += questionScore;
                        }
                        if (textInput) {
                            const right = Boolean(isCorrect && userAnswer);
                            textInput.classList.add(right ? 'result-correct' : 'result-incorrect');
                            if (!right) {
                                const note = document.createElement('p');
                                note.className = 'correct-answer-description';
                                note.textContent = `Correct answer: ${correctValues[0] || ''}`;
                                textInput.insertAdjacentElement('afterend', note);
                            }
                        }
                    }
                });
            
                // Display total score
                const scoreContainer = document.getElementById('score-container');
                scoreContainer.innerHTML = `<p class="quiz-score-line">Your score: <strong>${totalScore} of ${totalMaxScore}</strong></p>`;
                scoreContainer.style.display = 'block';

                // Disable interactivity for all options after submission
                document.querySelectorAll(".quiz-option").forEach(option => {
                    option.style.pointerEvents = "none";
                    option.classList.add('graded');
                });

                document.querySelectorAll("input.quiz-option").forEach(input => {
                    input.setAttribute("disabled", "true");
                });

                scoreContainer.innerHTML = `<p class="quiz-score-line">Your score: <strong>${totalScore} of ${totalMaxScore}</strong></p>`;
                scoreContainer.style.display = 'block';

                const postData = {
                    tour_id: tourID,
                    learner_id: userID,
                    total_score: totalScore,
                    start_at: quizStartTime.toISOString(),
                    ended_at: quizEndTime.toISOString(),
                };

                try {
                        const response = await fetch(`${window.LACY_API_URL}/api/post-tour-quiz-results`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(postData),
                    });

                } catch (error) {
            console.error('Unexpected error:', error);
        }

                const postAnswers = {
                    tour_id: tourID,
                    user_id: userID,
                    answers: userAnswers.map((answer, index) => ({
                        question_id: quizQuestions[index].question_id,
                        answer: answer // Keep the original answer from userAnswers
                    }))
                };
                try {
                    const response = await fetch(`${window.LACY_API_URL}/api/store-quiz-answers`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(postAnswers)
                    });
            
                } catch (error) {
            console.error('Unexpected error:', error);
        }

                if(localStorage.getItem('lastTourType' ) === 'guided'){
                    const completeResponse = await fetch(`${window.LACY_API_URL}/api/complete-tour`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userID,
                            tourID
                        })
                    });
                    
                    const result = await completeResponse.json();
                }

                finishQuizBtn.textContent = 'Continue';
                finishQuizBtn.disabled = false;
                scoreContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    }
    async function renderSolvedQuiz(userId, tourId, tourName, total_score) {
        const quizContainer = document.getElementById('quiz-container');

        if (!tourName) {
            return;
        }
        document.getElementById('loading-quiz').style.display = 'none';
        try {
            // Fetch quiz questions from the API
            const questionsResponse = await fetch(`${window.LACY_API_URL}/api/get-quiz-questions?tourName=${encodeURIComponent(tourName)}`);
            let quizQuestions = await questionsResponse.json();
            // Normalize options/answers to arrays
            quizQuestions = quizQuestions.map(q => ({
                ...q,
                options: normalizeArrayField(q.options),
                answers: normalizeArrayField(q.answers)
            }));

            if (!quizQuestions || quizQuestions.length === 0) {
                quizContainer.innerHTML = `
                    <div>
                        <p style="border: 2px solid">No quiz questions available to display.</p>
                        <button id="finish-quiz" class="submit-button">Return to Tours Tab</button>
                    </div>`;
                attachFinishQuizButton(tourName);
                return;
            }

            // Fetch user answers from the API
            const answersResponse = await fetch(`${window.LACY_API_URL}/api/get-quiz-answers?user_id=${userId}&tour_id=${tourId}`);
            const userAnswers = await answersResponse.json();
            // Normalize answers into maps keyed by question_id to avoid relying on array order
            const answersByQuestion = {};       // normalized lowercase answers for comparison
            const rawAnswersByQuestion = {};    // raw answers for display
            if (Array.isArray(userAnswers)) {
                userAnswers.forEach(a => {
                    try {
                        const qid = a && (a.question_id ?? a.questionId ?? a.question);
                        const raw = a && a.answer;
                        let arr = [];
                        if (Array.isArray(raw)) arr = raw.slice();
                        else if (typeof raw === 'string') {
                            try { const p = JSON.parse(raw); arr = Array.isArray(p) ? p : [p]; } catch (e) { arr = [raw]; }
                        } else if (raw == null) arr = [];
                        else arr = [raw];
                        // store raw for display
                        rawAnswersByQuestion[String(qid)] = arr;
                        // store normalized lowercase trimmed for comparison
                        answersByQuestion[String(qid)] = arr.map(v => (v == null ? '' : String(v)).trim().toLowerCase());
                    } catch (e) {
            console.error('Unexpected error:', e);
        }
                });
            }
            const scores = quizQuestions.map(q => q.score);
            const totalMaxScore = scores.reduce((acc, score) => acc + score, 0);

            // Render the solved quiz
                if (quizContainer) {
                quizContainer.innerHTML = `
                    <h1 class="quiz-title"><br>${tourName} Quiz</h1>
                    <div id="score-container" class="score-container">
                        <p class="score-text">Score:</p>
                        <div class="score-value">${total_score} / ${totalMaxScore}</div>
                    </div>
                    ${quizQuestions.map((question, index) => {
                        const options = normalizeArrayField(question.options);
                        const qId = question.question_id ?? question.id ?? (index + 1);
                        const qKey = String(qId);
                        const userAnswerNorm = answersByQuestion[qKey] || [];
                        const userAnswerRaw = rawAnswersByQuestion[qKey] || [];
                        const correctAnswers = (question.answers || []).map(ans => String(ans).trim().toLowerCase());
                        return `
                            <div class="quiz-question" data-type="${question.question_type}" data-index="${index}" data-question-id="${qId}">
                                <h3 class="question-text">${escapeHtml(question.question)}</h3>
                                <p class="question-score" style="color: #ccc; font-size: 0.9rem; margin-top: 5px;">
                                    Score: ${question.score}
                                </p>
                                ${question.question_type === 'checkbox' ? `
                                    <p class="multiple-answers-note" style="color: white; font-size: 0.9rem; margin-top: 5px;">
                                        For full credit you need to choose all correct options and none of the incorrect options. No partial credit will be given
                                    </p>
                                ` : ''}
                                <div class="quiz-answers">
                                        ${question.question_type === 'text' ? `
                                        <input type="text" class="quiz-option text" value="${escapeHtml(Array.isArray(userAnswerRaw) ? (userAnswerRaw[0] || '') : (userAnswerRaw || ''))}" readonly style="color: white;">
                                        <p class="correct-answer-description">Correct Answer: ${escapeHtml((question.answers || [])[0] || '')}</p>
                                    ` : `
                                        ${options.map(option => {
                                            const optNorm = String(option).trim().toLowerCase();
                                            const isCorrect = correctAnswers.includes(optNorm);
                                            const isSelected = Array.isArray(userAnswerNorm) && userAnswerNorm.includes(optNorm);
                                            const isGraded = true;
                                            // inline style to make selected correct/incorrect visually obvious
                                            const result = isCorrect ? (isSelected ? 'result-correct' : 'result-missed')
                                                : (isSelected ? 'result-incorrect' : '');
                                            return `
                                                <div class="quiz-option ${question.question_type}-option ${isCorrect ? 'correct' : ''} ${isSelected ? 'selected' : ''} ${isSelected && !isCorrect ? 'incorrect' : ''} ${isGraded ? 'graded' : ''} ${result}">
                                                    ${escapeHtml(option)}
                                                </div>
                                            `;
                                        }).join('')}
                                    `}
                                </div>
                            </div>
                        `;
                    }).join('')}
                    <button id="finish-quiz" class="-button">Return to Tours Tab</button>
                `;
            }

            attachFinishQuizButton(tourName);
        } catch (error) {
            quizContainer.innerHTML = `
                <div>
                    <p style="color: red;">An error occurred while loading the solved quiz. Please try again later.</p>
                    <button id="finish-quiz" class="return-button">Return to Tours Tab</button>
                </div>`;
            attachFinishQuizButton(tourName);
        }
    }

    function attachFinishQuizButton(tourName) {
        const finishQuizButton = document.getElementById("finish-quiz");
        if (finishQuizButton) {
            //main page'e döndüren kısım
            finishQuizButton.addEventListener("click", function () {
                if(localStorage.getItem('lastTourType' ) === 'exploration'){
                    document.getElementById('tours-tab')?.click();
                }
                vscode.postMessage({ command: 'completeQuiz', tourName: tourName });
            });
        }
    }

    // Function to validate a single question
    function validateQuestion(question) {
        const questionType = question.dataset.type;
        const selectedOptions = question.querySelectorAll(".quiz-option.selected");
        const userAnswer = question.querySelector("input")?.value.trim(); // For text questions
        let validationMessage = question.querySelector(".question-validation-message");
        // Create the validation message element if it doesn't exist
        if (!validationMessage) {
            validationMessage = document.createElement('div');
            validationMessage.className = 'question-validation-message';
            validationMessage.style.color = 'red';
            validationMessage.style.display = 'none';
            question.appendChild(validationMessage);
        }
    
        if (questionType === "radio" || questionType === "checkbox") {
            if (selectedOptions.length === 0) {
                // No option selected
                question.querySelector(".quiz-answers").style.border = "2px solid red"; // Highlight the unanswered question
                validationMessage.textContent = "Please select at least one option.";
                validationMessage.style.display = "block";
                return false;
            } else {
                // Option selected
                question.querySelector(".quiz-answers").style.border = "2px solid transparent"; // Reset border
                validationMessage.textContent = "";
                validationMessage.style.display = "none";
                return true;
            }
        } else if (questionType === "text") {
            if (!userAnswer) {
                // Text input is empty
                question.querySelector("input").style.border = "2px solid red"; // Highlight the unanswered question
                validationMessage.textContent = "Please enter an answer.";
                validationMessage.style.display = "block";
                return false;
            } else {
                // Text input is filled
                question.querySelector("input").style.border = "2px solid transparent"; // Reset border
                validationMessage.textContent = "";
                validationMessage.style.display = "none";
                return true;
            }
        }
        return true;
    }
    
    // Attach event listeners to each question for real-time validation
    function attachValidationListeners() {
        document.querySelectorAll(".quiz-question").forEach(question => {
            const questionType = question.dataset.type;
    
            // Add a validation message container
            const validationMessage = document.createElement("div");
            validationMessage.className = "question-validation-message";
            validationMessage.style.color = "red";
            validationMessage.style.display = "none";
            question.appendChild(validationMessage);
    
            if (questionType === "radio") {
                question.querySelectorAll(".quiz-option").forEach(option => {
                    option.addEventListener("click", function () {
                        const parent = this.closest(".quiz-question");
    
                        // Handle radio button behavior: deselect all other options
                        parent.querySelectorAll(".quiz-option").forEach(opt => opt.classList.remove("selected"));
    
                        // Select the clicked option
                        this.classList.add("selected");
    
                        // Validate the question after updating the selected state
                        validateQuestion(parent);
                    });
                });
            } else if (questionType === "checkbox") {
                question.querySelectorAll(".quiz-option").forEach(option => {
                    option.addEventListener("click", function () {

                        // Explicitly add or remove the 'selected' class
                        if (this.classList.contains("selected")) {
                            this.classList.remove("selected");
                        } else {
                            this.classList.add("selected");
                        }

                        // Validate the question after updating the selected state
                        validateQuestion(question);
                    });
                });
            } else if (questionType === "text") {
                const input = question.querySelector("input");
                input.addEventListener("input", () => {
                    validateQuestion(question); // Validate the question when the user types
                });
            }
        });
    }
                
});