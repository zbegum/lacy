import * as vscode from 'vscode';
import * as path from 'path';

import { serverUrl } from '../config';

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {

    //these need to be updates if any other file is added
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'registration', 'lacy_logo.png'));
    const loginCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'registration', 'login.css'));
    const themeCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'theme.css'));
    const sharedJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'shared.js'));
    const loginJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'registration', 'login.js'));
    const toursCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tours.css'));
    const toursJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tours.js'));
    const toursStepCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-step.css'));
    const toursStepJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-step.js'));

    const tourStepEditCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-step-edit.css'));

    const tourStepEditListCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-edit-list.css'));
    const tourStepEditListJsUri= webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-edit-list.js'));

    const tourquizJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-quiz.js'));
    const tourquizCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'tour-quiz.css'));
    const feedbackCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'feedback.css'));
    const feedbackJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'tours', 'feedback.js'));
    const audioJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'audio', 'audio.js'));
    const polishCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'polish.css'));
    const audioCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'sidebar-panel', 'audio', 'audio.css'));
    // Return the HTML with the resource URIs injected
    const html =  `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Webview Tabs</title>

            <link href="${themeCssUri}" rel="stylesheet" />

            <script>
                window.lacyLogoUri = "${logoUri}";
                // Where the Lacy server lives; configurable via the "lacy.serverUrl" setting.
                window.LACY_API_URL = "${serverUrl()}";

                // Send the session token with every call to the Lacy API. Keeping it
                // here means individual fetch calls do not have to think about auth.
                (function () {
                    const originalFetch = window.fetch;
                    window.fetch = function (input, init = {}) {
                        const url = typeof input === 'string' ? input : input?.url ?? '';
                        const token = localStorage.getItem('lacyToken');
                        if (token && url.startsWith(window.LACY_API_URL)) {
                            const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
                            headers.set('Authorization', 'Bearer ' + token);
                            init = { ...init, headers };
                        }
                        const isLacy = url.startsWith(window.LACY_API_URL);
                        const request = originalFetch(input, init);
                        if (!isLacy) return request;
                        // A network failure (not an HTTP error) means the server is not
                        // reachable; any answer at all means it is back.
                        return request.then(
                            (response) => { window.lacyConnection?.up(); return response; },
                            (err) => { window.lacyConnection?.down(); throw err; },
                        );
                    };
                })();

                // When the Lacy server stops answering, say so once, at the top of the
                // panel, keep checking, and pick up where things were when it is back.
                window.lacyConnection = (function () {
                    const originalFetch = window.fetch;
                    let isDown = false;
                    let timer = null;
                    const signedIn = () => {
                        const tabs = document.getElementById('app-tabs');
                        return tabs && tabs.style.display !== 'none';
                    };
                    const banner = () => {
                        let el = document.getElementById('lacy-offline');
                        if (!el) {
                            el = document.createElement('div');
                            el.id = 'lacy-offline';
                            el.className = 'lacy-offline';
                            el.setAttribute('role', 'status');
                            el.innerHTML = '<div class="lacy-offline-text"><strong>Can&rsquo;t reach the Lacy server</strong>'
                                + '<span id="lacy-offline-detail"></span></div>'
                                + '<button type="button" id="lacy-offline-retry">Try again</button>';
                            document.body.prepend(el);
                            el.querySelector('#lacy-offline-retry').addEventListener('click', check);
                        }
                        return el;
                    };
                    async function check() {
                        const detail = document.getElementById('lacy-offline-detail');
                        if (detail) detail.textContent = 'Checking…';
                        try {
                            const r = await originalFetch(window.LACY_API_URL + '/api/health', { cache: 'no-store' });
                            if (r.ok) { up(); return; }
                        } catch { /* still down */ }
                        if (detail) detail.textContent = window.LACY_API_URL + ' is not answering. Lacy keeps trying; nothing you have done is lost.';
                    }
                    function down() {
                        if (!signedIn()) return; // the sign-in form explains this itself
                        if (!isDown) {
                            isDown = true;
                            banner().hidden = false;
                            document.body.classList.add('is-offline');
                            check();
                            timer = setInterval(check, 5000);
                        }
                    }
                    function up() {
                        if (!isDown) return;
                        isDown = false;
                        clearInterval(timer);
                        document.body.classList.remove('is-offline');
                        const el = document.getElementById('lacy-offline');
                        if (el) el.hidden = true;
                        // Reload what failed to load while the server was away.
                        window.postMessage({ command: 'loadUserGuidedTours' }, '*');
                        window.postMessage({ command: 'refreshExplorations' }, '*');
                        vscode.postMessage({ command: 'showInfo', text: 'Connected to the Lacy server again.' });
                    }
                    // Check once when the panel opens, too: it may already be down.
                    window.addEventListener('load', () => setTimeout(() => {
                        if (signedIn()) originalFetch(window.LACY_API_URL + '/api/health').catch(down);
                    }, 1500));
                    return { up, down, check, get isDown() { return isDown; } };
                })();
            </script>
            <link href="${toursCssUri}" rel="stylesheet" />
            <link href="${toursStepCssUri}" rel="stylesheet" />
            <link href="${loginCssUri}" rel="stylesheet" />

            <link href="${tourStepEditCssUri}" rel="stylesheet" />
            <link href="${tourStepEditListCssUri}" rel="stylesheet" />
            <link href="${tourquizCssUri}" rel="stylesheet" />
            <link href="${feedbackCssUri}" rel="stylesheet" />
            <link href="${audioCssUri}" rel="stylesheet" />
            <!-- Last, so it can bring the older per-screen styles into line. -->
            <link href="${polishCssUri}" rel="stylesheet" />
            <style>
                .tabs { display: flex; margin-bottom: 10px; background-color: #0E0E0E; }
                .tab { padding: 10px 20px; cursor: pointer; font-weight: bold; }
                .tab.active { border-bottom: 3px solid #66479c; color: #66479c; background-color: #181818; }
                .content { display: none; }
                .content.active { display: block !important; }
            </style>
        </head>
        <body>
            <script>
                const vscode = acquireVsCodeApi();
            </script>
            <div id="loading-session" class="loading-overlay" style="display: none;">
                <div class="loading-spinner">Waiting for user session...</div>
            </div>
            <div id="loading-tour" class="loading-overlay" style="display: none;">
                <div class="loading-spinner">Creating your tour...</div>
            </div>
             <div id="loading-feedback" class="loading-overlay" style="display: none;">
                <div class="loading-spinner">Loading your feedback...</div>
            </div>
             <div id="loading-quiz" class="loading-overlay" style="display: none;">
                <div class="loading-spinner">Loading your quiz...</div>
            </div>
            <div id="confirmation-overlay" class="overlay" style="display: none;">
            <div class="modal">
                <p id="confirmation-text">Are you sure?</p>
                <div class="modal-buttons">
                <button id="confirmation-yes" class="tour-submit-button">Yes</button>
                <button id="confirmation-no" class="tour-cancel-button">No</button>
                </div>
            </div>
            </div>

            <div class="tabs" id="app-tabs" style="display: none;">
                <div class="tab" id="tours-tab">Explore</div>
                <div class="tab" id="my-tours-tab">My Tours</div>
                <div class="tab" id="audio-tab">Audio</div>
                <div class="tab" id="logout-tab" title="Sign out of Lacy">Sign out</div>
            </div>

            <div class="content" id="login-content">
                <div id="login-container"></div>
            </div>
            
            <div class="content" id="tours-content">
                <div id="tour-container"></div>
            </div>

            <div class="content" id="my-tours-content">
                <div id="my-tours-container">Loading Tours...</div>
            </div>

            <div class="content" id="podcast-page" style="display: none;">
                <div style="padding: 2rem; text-align: center;">
                    <h1>🎧 Podcast Mode</h1>
                    <p>This space will be used for podcast-related features.</p>
                    <button class="tour-cancel-button" id="exit-podcast">Return to Tours</button>
                </div>
            </div>

            <div class="content" id="tour-step-content">
                <div id="tour-step-container" style="position: relative;"></div>
            </div>
            
            <div class="content" id="tour-step-edit-content">
                <div id="tour-step-edit-container" style="position: relative;"></div>
            </div>

            <div class="content" id="tour-steps-edit-list-content">
                <div id="tour-steps-list-container" style="position: relative;" ></div>
            </div>

            <div class="content" id="audio-content">
                <div id="audio-container"></div>
            </div>

            <div id="unsaved-warning-overlay" class="overlay" style="display: none;">
            <div class="modal">
                <p>Unsaved changes. Leave anyway?</p>
                <div class="modal-buttons">
                    <button id="confirm-leave" class="tour-submit-button">Leave</button>
                    <button id="cancel-leave" class="tour-cancel-button">Stay</button>
                </div>
                </div>
            </div>

            <div class="content" id="quiz-content">
                <div id="quiz-container"></div>
            </div>
            <div class="content" id="quiz-question-content">
                <div id="quiz-question-container" style="position: relative;"></div>
            </div>
            <div class = "content" id="quiz-edit-content">
                <div id="quiz-edit-container" style="position: relative;"></div>
            </div> 
            
            <div class="content" id="feedback-content">
                <div id="feedback-container" style="position: relative;"></div>
            </div>

            <div class="content" id="quiz-creation-content">
                <div id="quizCreation-container" ></div>
            </div>     

            <div class="content" id="guidedTourForm-content">
                <div class="container" id="guidedTourForm-container" style="display:none;" ></div>
            </div>

            <div class="content" id="explorTourForm-content">
                <div  class="container" id="explorTourForm-container" style="display: none;"> </div>
            </div>
            
            <script>
                function showMainContent() {
                    document.getElementById('login-content').classList.remove('active');
                    document.getElementById('login-content').style.display = 'none';
                    document.getElementById('app-tabs').style.display = 'flex';
                    document.getElementById('tours-tab').classList.add('active');
                    document.getElementById('tours-content').classList.add('active');
                    document.getElementById('guidedTourForm-content').classList.add('active');
                    document.getElementById('explorTourForm-content').classList.add('active');

                    // Check if user is an expert and show the audio recording tab
                    const state = vscode.getState() || {};
                    if (state.user && state.user.role === "expert") {
                        document.getElementById('audio-tab').style.display = 'block';
                    } else {
                        document.getElementById('audio-tab').style.display = 'none';
                    }
                }

                window.addEventListener('load', () => {
                    const waitingOverlay = document.getElementById('loading-session');
                    const loginContent = document.getElementById('login-content');
                    const appTabs = document.getElementById('app-tabs');

                    // Show the waiting overlay initially
                    waitingOverlay.style.display = 'flex';
                    
                    // Request session and user from the backend
                    vscode.postMessage({ command: 'requestSession' });
                    vscode.postMessage({ command: 'requestUser' });

                    // Add a timeout to hide the waiting overlay and show the login form
                    const timeout = setTimeout(() => {
                        waitingOverlay.style.display = 'none';
                        loginContent.style.display = 'block';
                        loginContent.classList.add('active');
                    }, 5000); // 5 seconds timeout

                    window.addEventListener('message', (event) => {
                        const message = event.data;

                        if (message.command === 'restoreSession') {
                            clearTimeout(timeout); // Clear the timeout if session is found
                            if (message.userSession) {

                                // Hide the waiting overlay and show the main content
                                waitingOverlay.style.display = 'none';
                                appTabs.style.display = 'flex';
                                loginContent.style.display = 'none';
                            } else {

                                // Hide the waiting overlay and show the login form
                                waitingOverlay.style.display = 'none';
                                loginContent.style.display = 'block';
                                loginContent.classList.add('active');
                            }
                        }

                        else if (message.command === 'restoreUser') {
                            clearTimeout(timeout); // Clear the timeout if user is found
                            if (message.user) {
                                const user = message.user;
                                const userSession = message.userSession;
                                const state = vscode.getState() || {};
                                const newState = { ...state, user: message.user, userSession: message.userSession }; 
                                vscode.setState(newState);

                                // Hide the waiting overlay and show the main content
                                waitingOverlay.style.display = 'none';
                                appTabs.style.display = 'flex';
                                loginContent.style.display = 'none';
                            } else {

                                // Hide the waiting overlay and show the login form
                                waitingOverlay.style.display = 'none';
                                loginContent.style.display = 'block';
                                loginContent.classList.add('active');
                            }
                        }
                    });
                });

                window.addEventListener('message', (event) => {
                    const message = event.data;

                    if (message.command === 'restoreSession') {
                        if (message.userSession) {
                            const userSession = message.userSession;

                            const state = vscode.getState() || {};
                            const newState = { ...state, user: message.user, userSession: message.userSession }; 
                            vscode.setState(newState);
                            
                            showMainContent();
                        }
                    }
                    else if(message.command === 'restoreUser') {
                        if (message.user) {
                            const user = message.user;
                            const userSession = message.userSession;
                            const state = vscode.getState() || {};
                            const newState = { ...state, user: message.user, userSession: message.userSession }; 
                            vscode.setState(newState);

                            // Show or hide the audio recording tab based on user role
                            if (user.role === "expert") {
                                document.getElementById('audio-tab').style.display = 'block';
                            } else {
                                document.getElementById('audio-tab').style.display = 'none';
                            }
                        }

                    } 
                    else if (message.command === 'updateTourStep') {
                        document.getElementById('tour-step-content').classList.add('active');
                        document.getElementById('tours-content').classList.remove('active');
                        document.getElementById('quiz-content').classList.remove('active');
                        document.getElementById('my-tours-content').classList.remove('active');

                    }
                    
                    else if( message.command== 'updateEditTourStepList'){
                        document.getElementById('tour-steps-edit-list-content').classList.add('active');
                        document.getElementById('tour-step-edit-content').classList.remove('active');

                        document.getElementById('tours-content').classList.remove('active');
                        document.getElementById('tour-step-content').classList.remove('active');
                        document.getElementById('quiz-content').classList.remove('active');
                    }

                    else if (message.command === 'showQuiz') {
                        // tour-step.js switches to the quiz page (and only that page).

                    } 
                    
                    else if (message.command === 'renderFeedbackPage') {

                        // Only the feedback page is showing. Classes only: inline display
                        // styles here used to stick, hiding pages or keeping this one up.
                        document.querySelectorAll('.content').forEach(content => {
                            content.classList.toggle('active', content.id === 'feedback-content');
                        });
                        // feedback.js renders the page itself from this same message.
                    }

                    else if (message.command === 'toursForAudioLoaded') {
                        const tourSelect = document.getElementById('tour-select');
                        tourSelect.innerHTML = '<option value="">Select a tour...</option>';
                        
                        message.tours.forEach(tour => {
                            const option = document.createElement('option');
                            option.value = tour.id;
                            option.textContent = tour.name;
                            tourSelect.appendChild(option);
                        });
                    }
                });

                function showConfirmation(message, confirmText = 'Yes', cancelText = 'No', onConfirm) {
                    const overlay = document.getElementById('confirmation-overlay');
                    document.getElementById('confirmation-text').textContent = message;
                    document.getElementById('confirmation-yes').textContent = confirmText;
                    document.getElementById('confirmation-no').textContent = cancelText;

                    // A destructive confirm gets a red button.
                    overlay.classList.toggle('is-danger', /delete/i.test(confirmText));
                    overlay.style.display = 'flex';

                    const yesBtn = document.getElementById('confirmation-yes');
                    const noBtn = document.getElementById('confirmation-no');

                    yesBtn.onclick = () => {
                        overlay.style.display = 'none';
                        if (onConfirm) onConfirm();
                    };
                    noBtn.onclick = () => {
                        overlay.style.display = 'none';
                    };
                }

                function logout() {
                    fetch(window.LACY_API_URL + '/api/logout', { method: 'POST' }).catch(function () { /* the token is dropped locally either way */ });
                    localStorage.removeItem('lacyToken');
                    vscode.postMessage({ command: 'logout' });
                    document.getElementById('app-tabs').style.display = 'none';
                    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                    
                    vscode.setState({ user: null, userSession: null });

                    // Remove any question containers
                    const askQuestionContainer = document.getElementById('ask-question-container');
                    if (askQuestionContainer) {
                        askQuestionContainer.remove();
                    }

                    // Remove any question modals
                    const questionModal = document.getElementById('question-modal');
                    if (questionModal) {
                        questionModal.style.display = 'none';
                    }

                    document.querySelectorAll('.content').forEach(content => {
                        content.classList.remove('active');
                    });

                    document.querySelectorAll('.container').forEach(container => {
                        container.style.display = 'none';
                    });

                    let detailSelectorContainer = document.getElementById('file-detail-selector');
                    if(detailSelectorContainer) {
                        detailSelectorContainer.style.display = 'none';
                    }

                    const emailInput = document.getElementById('email');
                    const passwordInput = document.getElementById('password');
                    if (emailInput) emailInput.value = '';
                    if (passwordInput) passwordInput.value = '';

                    document.getElementById('login-content').style.display = 'block';
                    document.getElementById('login-content').classList.add('active');
                }

                document.getElementById('tours-tab').addEventListener('click', async () => {

                    if (document.getElementById('guided-tour-form') || document.getElementById('explor-tour-form')){
                        const leaveConfirmed = await confirmLeaveIfDirty();
                        if (!leaveConfirmed) return;

                        // Add these lines to reset forms when leaving is confirmed
                        if (document.getElementById('guided-tour-form')) {
                            document.getElementById('guided-tour-form').reset();
                        }
                        if (document.getElementById('explor-tour-form')) {
                            document.getElementById('explor-tour-form').reset();
                        }
                        // Clear selections as well
                        vscode.postMessage({ command: 'resetTourFormAndSelections' });
                    }

                    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                    document.querySelectorAll('.content').forEach(content => content.classList.remove('active'));
                    document.getElementById('podcast-page').style.display = 'none';

                    let detailSelectorContainer = document.getElementById('file-detail-selector');
                    if(detailSelectorContainer) {
                        detailSelectorContainer.style.display = 'none';
                    }

                    document.getElementById('tours-tab').classList.add('active');
                    document.getElementById('tours-content').classList.add('active');

                    document.getElementById('guidedTourForm-content').classList.add('active');   
                    document.getElementById('explorTourForm-content').classList.add('active');

                    document.getElementById('guidedTourForm-container').style.display = 'none';
                    document.getElementById('explorTourForm-container').style.display = 'none';
                    document.getElementById('my-tours-container').style.display = 'none';

                    document.getElementById('tour-container').style.display = 'block';

                    document.getElementById('quiz-edit-container').classList.add('active');
                    document.getElementById('quiz-edit-container').style.display = 'none';
                    document.getElementById('ask-question-container')?.remove();
                });

                document.getElementById('my-tours-tab').addEventListener('click', async () => {
                    const leaveConfirmed = await confirmLeaveIfDirty();
                    if (!leaveConfirmed) return;

                    if (document.getElementById('guided-tour-form')) {
                        document.getElementById('guided-tour-form').reset();
                    }
                    if (document.getElementById('explor-tour-form')) {
                        document.getElementById('explor-tour-form').reset();
                    }
                    // Clear selections as well
                    vscode.postMessage({ command: 'resetTourFormAndSelections' });

                    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                    document.querySelectorAll('.content').forEach(content => content.classList.remove('active'));
                    document.getElementById('podcast-page').style.display = 'none';
                    document.getElementById('tour-container').style.display = 'none';

                    document.getElementById('my-tours-tab').classList.add('active');
                    document.getElementById('my-tours-content').classList.add('active');
                    document.getElementById('my-tours-container').style.display = 'block';

                    let detailSelectorContainer = document.getElementById('file-detail-selector');
                    if(detailSelectorContainer) {
                        detailSelectorContainer.style.display = 'none';
                    }

                    vscode.postMessage({ command: 'loadUserGuidedTours' })
                    document.getElementById('ask-question-container')?.remove();
                });

                document.getElementById('audio-tab').addEventListener('click', async () => {
                    const leaveConfirmed = await confirmLeaveIfDirty();
                    if (!leaveConfirmed) return;

                    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                    document.querySelectorAll('.content').forEach(content => content.classList.remove('active'));

                    document.getElementById('audio-tab').classList.add('active');
                    document.getElementById('audio-content').classList.add('active');

                    vscode.postMessage({ command: "activateAudioTab" });
                });

                window.onerror = function (msg, url, lineNo, columnNo, error) {
                };
                
                window.onerror = function (msg, url, lineNo, columnNo, error) {
                };

            </script>
            <script src="${sharedJsUri}"></script>
            <script src="${loginJsUri}"></script>
            <script src="${toursJsUri}"></script>
            <script src="${toursStepJsUri}"></script>
            <script src="${tourquizJsUri}"></script>
            <script src="${feedbackJsUri}"></script>
            <script src="${tourStepEditListJsUri}" type="module"></script>
            <script src="${audioJsUri}"></script>
        </body>
        </html>
    `;
    return html;
}