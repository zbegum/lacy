let formIsDirty = false;
document.addEventListener('DOMContentLoaded', async () => {
    vscode.postMessage({ command: 'webviewReady' });

    let projectFiles = [];
    let projectName;
    let projectKey = '';
    const selectedFiles = new Set();
    const selectedFileParts = new Map(); // Map<filePath, Array<{start: number, end: number, description: string}>>

    const tourContainer = document.getElementById('tour-container');
    const guidedTourCreationContainer = document.getElementById('guidedTourForm-container');
    const exploratoryTourCreationContainer= document.getElementById('explorTourForm-container');
    const quizEditContainer = document.getElementById('quiz-edit-container');

    function applyInitialRolePermissions() {
        const state = vscode.getState();
        const user = state?.user;
    
        const wrapper = document.getElementById('tour-ui-wrapper');
        const tourContainer = document.getElementById('tour-container');
    
        // Hide all initially
        if (wrapper) wrapper.style.display = 'none';
        if (tourContainer) tourContainer.style.display = 'none';
    
        if (user && user.role) {
    
            if (wrapper) wrapper.style.display = 'block';
            if (tourContainer) tourContainer.style.display = 'block';
    
            fetchExplorationTours(); 
        } else {
            vscode.postMessage({ command: 'requestUser' });
        }
    }

// Tour creation shows a blocking overlay and disables every button; this puts the
// UI back however the request ends, so a failure cannot leave the sidebar stuck.
function setTourCreationBusy(busy) {
    const overlay = document.getElementById('loading-tour');
    if (overlay) overlay.style.display = busy ? 'flex' : 'none';
    document.querySelectorAll('button').forEach(btn => { btn.disabled = busy; });
}

// Ask the extension for the contents of the selected files. The server generates
// tours from what we send, so it never needs access to this machine's disk.
function requestProjectFileContents(files) {
    return new Promise((resolve) => {
        const requestId = `files-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeout = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            resolve({});
        }, 30000);

        function onMessage(event) {
            const message = event.data;
            if (message.command === 'projectFilesContent' && message.requestId === requestId) {
                clearTimeout(timeout);
                window.removeEventListener('message', onMessage);
                resolve(message.contents || {});
            }
        }

        window.addEventListener('message', onMessage);
        vscode.postMessage({ command: 'readProjectFiles', requestId, files });
    });
}

    window.addEventListener("message", (event) => {
        const data = event.data;
        if (data.command === 'loadFiles') {
            projectFiles = data.files;
            basePath = data.basePath;
            projectName = data.projectName;
            projectKey = data.projectKey || '';
            localStorage.setItem('projectKey', projectKey);
            
            localStorage.setItem('projectName', projectName);

            const state = vscode.getState();
            const user = state?.user;

            if (user && user.id) {
                applyInitialRolePermissions(); // also loads the exploration tours
                localStorage.setItem('user', JSON.stringify(user)); 
            }
        }
        else if (data.command === 'resetTourFormAndSelections') {
            resetTourForms();  
        }
        else if (data.command === 'updateSelection') {
            const lineStartInput = document.getElementById('line-start');
            const lineEndInput = document.getElementById('line-end');
            if (lineStartInput && lineEndInput) {
                lineStartInput.value = data.startLine;
                lineEndInput.value = data.endLine;
            }
        }
        else if (data.command === 'refreshExplorations') {
            fetchExplorationTours();
        }
        else if (data.command === 'loadUserGuidedTours') {
            renderMyToursUI();
            loadUsersGuidedTours();
        }

        else if (data.command === 'showPeekedTourInfo') {
            showPeekedTourInfo(data.tourName, data.summary);
        }
        else if (data.command === 'deletedTour' || data.command === 'tourDeleted') {

            (async () => {
                if(data.tour_type === "guided"){
                    try {
                        document.getElementById('loading-tour').style.display = 'flex';
                        document.querySelectorAll('button').forEach(btn => (btn.disabled = false));
    
                        clearAllViews();
                        await loadUsersGuidedTours();
    
                        document.getElementById('my-tours-container').style.display = 'block';
                        document.getElementById('my-tours-content').classList.add('active');
                    } catch (err) {
            console.error('Unexpected error:', err);
        } finally {
                        document.getElementById('loading-tour').style.display = 'none';
                    } 
                } if(data.tour_type === "exploration"){ 

                     try {
                        document.getElementById('explor-tour-form').reset();
                        document.getElementById('loading-tour').style.display = 'flex';
                        document.querySelectorAll('button').forEach(btn => (btn.disabled = false));
    
                        clearAllViews();
                        formIsDirty = false;
                        document.getElementById('tour-container').style.display = 'block';
                        await fetchExplorationTours();
                    } catch (err) {
            console.error('Unexpected error:', err);
        } finally {
                        document.getElementById('loading-tour').style.display = 'none';
                    } 
                }
            })(); 
        }

    });

    /** The ⓘ card: what a tour is, who it is for, what it covers and how it is going. */
    function showPeekedTourInfo(name, summary) {
        const modalBody = document.getElementById('tour-info-body');
        const infoModal = document.getElementById('tour-info-modal');
        if (!modalBody || !infoModal) return;

        const close = () => { modalBody.innerHTML = ''; infoModal.classList.add('hidden'); };
        const closeBtn = document.getElementById('close-tour-info');
        if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); close(); };
        infoModal.onclick = (e) => { if (e.target === infoModal) close(); };

        if (!summary) {
            modalBody.innerHTML = `<h2 class="tour-info-title">${escapeHtml(name)}</h2>
                <p class="tour-info-empty">Could not load this tour's details. Check that the Lacy server is running.</p>`;
            return;
        }

        const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
        const created = summary.createdAt ? new Date(String(summary.createdAt).replace(' ', 'T') + 'Z') : null;
        const createdText = created && !isNaN(created) ? created.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
        const rows = [
            ['For', summary.guided ? escapeHtml(summary.department || 'Everyone') : 'Just you'],
            ['Steps', escapeHtml(plural(summary.stepCount, 'step'))],
            ['Quiz', summary.quizQuestions ? escapeHtml(plural(summary.quizQuestions, 'question')) : 'None'],
            ['Podcast', summary.hasPodcast ? 'Yes' : 'None'],
            ['Created', escapeHtml(createdText)],
        ];
        if (summary.learners) {
            const { assigned, completed } = summary.learners;
            rows.push(['Learners', assigned ? `${completed} of ${assigned} finished` : 'Nobody assigned yet']);
        }

        const files = (summary.files || []).map((file) => {
            const slash = file.path.lastIndexOf('/');
            const dir = slash > -1 ? file.path.slice(0, slash + 1) : '';
            const base = file.path.slice(slash + 1);
            const lines = file.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
            return `<li class="tour-info-file">
                <span class="tour-info-file-name" title="${escapeHtml(file.path)}"><span class="tour-info-dir">${escapeHtml(dir)}</span>${escapeHtml(base)}</span>
                <span class="tour-info-file-meta">${escapeHtml(plural(file.steps, 'step'))} · lines ${escapeHtml(lines)}</span>
            </li>`;
        }).join('');

        modalBody.innerHTML = `
            <span class="tour-info-kind">${summary.guided ? 'Guided tour' : 'Exploration'}</span>
            <h2 class="tour-info-title">${escapeHtml(summary.name)}</h2>
            ${summary.focus ? `<p class="tour-info-focus"><span>Focus</span>${escapeHtml(summary.focus)}</p>` : ''}
            <dl class="tour-info-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
            <h3 class="section-heading tour-info-files-heading">Files</h3>
            ${files ? `<ul class="tour-info-files">${files}</ul>` : '<p class="tour-info-empty">No steps yet.</p>'}
        `;
    }

    async function loadUsersGuidedTours() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const userId = user?.id;
            const role = user?.role;
            
            if (!userId || !role) {
                return;
            }
    
            let response;
            if (role === 'learner') {
                response = await fetch(`${window.LACY_API_URL}/api/get-guided-tours-assigned-to-user?projectName=${encodeURIComponent(projectName)}&projectKey=${encodeURIComponent(projectKey)}`);
            } else if (role === 'expert') {
                response = await fetch(`${window.LACY_API_URL}/api/get-guided-tours-created-by-user?projectName=${encodeURIComponent(projectName)}&projectKey=${encodeURIComponent(projectKey)}`);
            } else {
                return;
            }
            
            if (!response || !response.ok) {
                document.getElementById('my-guided-tours-list').innerHTML = '<li>Error loading tours</li>';
                return;
            }
            
            const tours = await response.json();
            
            renderMyTours(tours);
        } catch (error) {
            document.getElementById('my-guided-tours-list').innerHTML = '<li>Error loading tours</li>';
        }
    }

    function renderMyToursUI() {
        const myToursContainer = document.getElementById('my-tours-container');
        
        const state = vscode.getState();
        const user = state?.user;
        const userRole = user?.role || 'learner';
        const projectName = localStorage.getItem('projectName') || 'Unknown Project';
        myToursContainer.innerHTML = `
        <div id="tour-ui-wrapper" style="display: none; height: 100%; display: flex; justify-content: center; align-items: center;">
            <div class="tour-wrapper" style="text-align: center; max-width: 600px; width: 100%;">
                <h1 class="tour-title">${userRole === 'expert' ? 'Tours I\'ve prepared' : 'Tours prepared for me'}</h1>
                <h2 class="tour-subtitle">Project: ${projectName}</h2>
                <p class="tour-description" style="font-family: 'Poppins', sans-serif; font-size: 1rem; color: #ccc; margin-bottom: 2rem;">
                    ${userRole === 'expert' ? 
                        'Guided tours you made for your team. Edit them here; See Dashboard shows how each person is doing.' : 
                        'Guided tours your team\'s experts made for you. Start with the first one.'}
                </p>
    
                ${userRole === 'expert' ? `
                    <div class="tour-header" style="margin-bottom: 1.5rem;">
                    <div class="border-animated-container" style="margin-bottom: 1rem;">
                        <button id="new-guided-tour-my-tours" class="create-tour-button">New Guided Tour</button>
                    </div>
                    <div class="border-animated-container" style="margin-bottom: 1rem;">
                        <button id="dashboard-tab" class="tour-cancel-button">See Dashboard</button>
                    </div>
                    <div id="guided-tour-modal" class="modal-overlay hidden" role="dialog" aria-labelledby="guided-tour-modal-title">
                        <div class="modal tour-method-modal">
                            <div class="tour-method-header">
                                <h2 id="guided-tour-modal-title">New guided tour</h2>
                                <button id="close-modal-button" class="tour-method-close" title="Close" aria-label="Close">&times;</button>
                            </div>
                            <div class="tour-method-options">
                                <button id="autogenerated-tour-button" class="tour-submit-button tour-method-button">AI assisted</button>
                                <p class="tour-method-hint">Pick files; Lacy writes the steps.</p>
                                <button id="voice-tour-button" class="tour-cancel-button tour-method-button">Voice</button>
                                <p class="tour-method-hint" id="voice-tour-hint">Talk through the code; Lacy turns it into steps.</p>
                                <button id="manual-tour-button" class="tour-cancel-button tour-method-button">Manual</button>
                                <p class="tour-method-hint">Write each step yourself.</p>
                            </div>
                        </div>
                    </div>
                    <div id="tour-info-modal" class="modal-overlay hidden">
                        <div class="modal tour-method-modal" id="tour-info-content" role="dialog" aria-label="Tour details">
                            <button id="close-tour-info" class="tour-method-close tour-info-close" title="Close" aria-label="Close">&times;</button>
                            <div id="tour-info-body"></div>
                        </div>
                    </div>
                </div>
                ` : ''}
                <ul id="my-guided-tours-list" class="tour-list">
                    <li>Loading tours...</li>
                </ul>
            </div>
        </div>
        `;

        if (userRole === 'expert') {
            const newGuidedTourButton = document.getElementById('new-guided-tour-my-tours');
            const modal = document.getElementById('guided-tour-modal');
            if (newGuidedTourButton) {
                newGuidedTourButton.addEventListener('click', () => {
                    modal.classList.remove('hidden');
                    checkVoiceTours();
                    if (!modal.dataset.listenersAttached) {
                        attachModalEventListeners();
                        modal.dataset.listenersAttached = 'true';
                    }
                });
            }

            //See Dashboard button
            const dashboardBtn = document.getElementById('dashboard-tab');
            if (dashboardBtn) {
                dashboardBtn.addEventListener('click', () => {
                    const state = vscode.getState();
                    const user = state?.user;
                    if (!user || !user.id) {
                        vscode.postMessage({ command: 'showError', text: 'Please log in first.' });
                        return;
                    }
        
                    vscode.postMessage({ command: 'runDevDashboard' });
                });
            }
                        
            // Handle "Autogenerated Tour" button click
            function attachModalEventListeners() {
                const autogeneratedTourButton = document.getElementById('autogenerated-tour-button');
                const manualTourButton = document.getElementById('manual-tour-button');
                const closeModalButton = document.getElementById('close-modal-button');
                // Handle "Autogenerated Tour" button click
                if (autogeneratedTourButton) {
                    autogeneratedTourButton.addEventListener('click', () => {
                        modal.classList.add('hidden'); // Hide the modal
                        // Perform the existing functionality of "new-guided-tour-my-tours"
                        const myToursContainer = document.getElementById('my-tours-container');
                        const guidedTourCreationContainer = document.getElementById('guidedTourForm-container');
                        myToursContainer.style.display = 'none';
                        document.getElementById('my-tours-content').classList.remove('active');
                        guidedTourCreationContainer.style.display = 'block';
                        document.getElementById('guidedTourForm-content').classList.add('active');
                        clearSelections();
                        createFileExplorer(projectFiles, 'file-explorer-guided');
                        populateTourOptions({ modelSelectId: 'guided-llm-model', languageSelectId: 'guided-language', submitButtonId: 'guided-tour-form-submit', podcastToggleId: 'podcast-toggle' });
                    });
                }
        
                // Handle "Manual Tour" button click
                if (manualTourButton) {
                    manualTourButton.addEventListener('click', () => {
                        vscode.postMessage({command: "createTourManual", 
                            body:{
                                user_id: JSON.parse(localStorage.getItem('user')).id,
                                project_name: projectName,
                                project_key: projectKey,
                                isGuided: 1
                            }
                        });
                        document.getElementById('my-tours-content').classList.remove('active');
                        document.getElementById('tour-steps-edit-list-content').classList.add('active');
                    });
                }
                // "Voice": the same recorder as the Audio tab.
                const voiceTourButton = document.getElementById('voice-tour-button');
                if (voiceTourButton) {
                    voiceTourButton.addEventListener('click', () => {
                        modal.classList.add('hidden');
                        document.getElementById('audio-tab')?.click();
                    });
                }

                // Clicking the dimmed background or pressing Escape closes it too.
                modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden');
                });

                // Close the modal when the "Close" button is clicked
                if (closeModalButton) {
                    closeModalButton.addEventListener('click', () => {
                        modal.classList.add('hidden');
                    });
                }
            }
            
}
    }

    function renderMyTours(tours) {

        const myToursList = document.getElementById('my-guided-tours-list');
        
        if (!myToursList) {
            return;
        }
        
        if (!tours || tours.length === 0) {
            myToursList.innerHTML = '<li class="no-tours">No tours found.</li>';
            return;
        }
        
        // Sort tours alphabetically
        tours.sort((a, b) => a.name.localeCompare(b.name));
        
        // Get user role for showing appropriate buttons
        const state = vscode.getState();
        const userRole = state?.user?.role || 'learner';
        
        // Clear existing content
        myToursList.innerHTML = '';
        
        // Create list items for each tour
        tours.forEach((tour) => {
            const listItem = document.createElement('li');
            listItem.className = 'tour-item';

            if (tour.tour_status === 'completed') {
                listItem.classList.add('completed-tour');
            }
    
            const tourName = document.createElement('span');
            tourName.className = 'tour-name';
            tourName.textContent = tour.name;

            if (tour.tour_status === 'completed') {
                // Shown by the card's green tint; the words are for screen readers.
                listItem.classList.add('completed-tour');
                listItem.title = 'Completed';
                const statusLabel = document.createElement('span');
                statusLabel.className = 'visually-hidden';
                statusLabel.textContent = ' (completed)';
                tourName.appendChild(statusLabel);
            }
    
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'button-container';
            
            if (tour.hasPodcast) {
                const podcastButton = document.createElement('button');
                podcastButton.className = 'podcast-button';
                podcastButton.innerHTML = '<span class="lacy-icon">🎧</span>';
                podcastButton.title = 'Podcast';
                podcastButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    prev = tourContainer.style.display === 'block'
                            ? 'tour-container'
                            : 'my-tours-container'
                    vscode.postMessage({command: "podcastTour", tourId: tour.id, tourName: tour.name, isGuided: tour.isGuided});

                    clearAllViews(); // hide all other content
                    document.getElementById('my-tours-content').classList.remove('active');
                    document.getElementById('tour-steps-edit-list-content').classList.add('active');
                });
                buttonContainer.appendChild(podcastButton);
            }    
    
            // Only add edit/delete buttons for experts
            if (userRole === 'expert') {
                const editButton = document.createElement('button');
                editButton.className = 'edit-button';
                editButton.innerHTML = '<span class="lacy-icon">✎</span>';
                editButton.title = 'Edit';
                editButton.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent tour start
                    clearAllViews()
                    vscode.postMessage({
                        command: 'goToStepList',
                        tourName: tour.name,
                        tourId: tour.id
                    });
                });
                buttonContainer.appendChild(editButton);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-button';
                deleteButton.innerHTML = '<span class="lacy-icon">🗑</span>';
                deleteButton.title = 'Delete';
                deleteButton.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent tour start
                
                    showConfirmation(
                        `Delete "${tour.name}"? Everyone's progress and quiz results for it go too.`,
                        'Delete',
                        'Cancel',
                        () => {
                            vscode.postMessage({
                                command: 'deleteTour',
                                tour_id: tour.id
                            });
                
                            const messageHandler = event => {
                                const message = event.data;
                                if (message.command === 'deleteTourResponse') {
                                    window.removeEventListener('message', messageHandler);
                                    if (message.success) {
                                        listItem.remove();
                                    }
                                }
                            };
                            window.addEventListener('message', messageHandler);
                        }
                    );
                });
                buttonContainer.appendChild(deleteButton);

                //Additional Info about Tours
                const infoToggle = document.createElement('button');
                infoToggle.className = 'info-toggle-button';
                infoToggle.innerHTML = '<span class="lacy-icon">ⓘ</span>';
                infoToggle.title = 'Show more info';

                const infoContainer = document.createElement('div');
                infoContainer.className = 'tour-info';
                infoContainer.style.display = 'none'; // hidden by default

                infoToggle.addEventListener('click', (e) => {
                    e.stopPropagation(); // ⬅️ this prevents triggering the parent’s click
                    document.getElementById('tour-info-body').innerHTML = '<p class="tour-info-loading">Loading…</p>';
                    vscode.postMessage({
                        command: 'peekTourInfo',
                        tourName: tour.name,
                        tourId: tour.id,
                    });

                    // Show modal overlay
                    const modal = document.getElementById('tour-info-modal');
                    modal.classList.remove('hidden');
                });

                buttonContainer.appendChild(infoToggle);
                listItem.appendChild(infoContainer);
            }
    
            listItem.appendChild(tourName);
            listItem.appendChild(buttonContainer);
    
            // Add click handler to start the tour when clicking anywhere on the item
            listItem.addEventListener('click', () => {
                localStorage.setItem('selectedTourName', tour.name);
                localStorage.removeItem('tourStartTime');
                const tourStartTime = Date.now();
                localStorage.setItem('tourStartTime', tourStartTime);
                
                vscode.postMessage({
                    command: 'startTour',
                    tourName: tour.name,
                    tourId: tour.id,
                    userId: JSON.parse(localStorage.getItem('user')).id,
                    tourStartTime: tourStartTime
                });
                localStorage.setItem('lastTourType', tour.isGuided ? 'guided' : 'exploration');
            });
            
            myToursList.appendChild(listItem);
        });
    }

    // Fetch tours from the database/API
    async function fetchExplorationTours(newTourId = null) {
        try {
            const user = JSON.parse(localStorage.getItem('user')); // Parse the string into an object
            const userId = user?.id; // Safely access the `id` property
            //get this project's tours only
            const response = await fetch(`${window.LACY_API_URL}/api/get-exploration-tours?projectName=${encodeURIComponent(projectName)}&projectKey=${encodeURIComponent(projectKey)}`); // Correct API endpoint
            if (response.ok) {
                const tours = await response.json();
                renderExplorationTours(tours, newTourId);
            } else {
                exploratoryToursList.innerHTML = '<li>Error loading exploration tours</li>';
            }
        } catch (error) {
            exploratoryToursList.innerHTML = '<li>Error loading tours</li>';
        }
    }

    // Render the tours into their respective sections
    function renderExplorationTours(tours, newTourId = null) {
        const justCreatedTourId = newTourId;
        exploratoryToursList.innerHTML = '';
        tours.sort((a, b) => a.name.localeCompare(b.name));

        // Get user role before creating buttons
        const state = vscode.getState();
        const userRole = state?.user?.role || 'learner'; // Default to learner if not found

        tours.forEach((tour) => {
            const listItem = document.createElement('li');
            listItem.className = 'tour-item';

            const tourName = document.createElement('span');
            tourName.className = 'tour-name';
            tourName.textContent = tour.name;

            // "New" only on the tour just created, and only on that first showing.
            if (justCreatedTourId != null && Number(tour.id) === Number(justCreatedTourId)) {
                const newBadge = document.createElement('span');
                newBadge.className = 'new-badge';
                newBadge.textContent = 'New';
                tourName.appendChild(newBadge);
            }
            if (tour.tour_status === 'completed') {
                // Shown by the card's green tint; the words are for screen readers.
                listItem.classList.add('completed-tour');
                listItem.title = 'Completed';
                const statusLabel = document.createElement('span');
                statusLabel.className = 'visually-hidden';
                statusLabel.textContent = ' (completed)';
                tourName.appendChild(statusLabel);
            }

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'button-container';

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.innerHTML = '<span class="lacy-icon">🗑</span>';
            deleteButton.title = 'Delete';
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent tour start
            
                showConfirmation(
                    `Delete "${tour.name}"? This cannot be undone.`,
                    'Delete',
                    'Cancel',
                    () => {
                        vscode.postMessage({
                            command: 'deleteTour',
                            tour_id: tour.id
                        });
            
                        const messageHandler = event => {
                            const message = event.data;
                            if (message.command === 'deleteTourResponse') {
                                window.removeEventListener('message', messageHandler);
                                if (message.success) {
                                    listItem.remove();
                                }
                            }
                        };
                        window.addEventListener('message', messageHandler);
                    }
                );
            });
            buttonContainer.appendChild(deleteButton);

            listItem.appendChild(tourName);
            listItem.appendChild(buttonContainer);

            listItem.addEventListener('click', () => {
                localStorage.setItem('selectedTourName', tour.name);
                localStorage.removeItem('tourStartTime'); // Clear previous tour start time
                const tourStartTime = Date.now(); // Record the start time
        
                localStorage.setItem('tourStartTime', tourStartTime);
                vscode.postMessage({
                    command: 'startTour',
                    tourName: tour.name,
                    tourId: tour.id,
                    userId: JSON.parse(localStorage.getItem('user')).id
                });
                localStorage.setItem('lastTourType', tour.isGuided ? 'guided' : 'exploration');
            });
    
            exploratoryToursList.appendChild(listItem);
            
        });
      
    }

    // Load the tours when the page is loaded
    const projectNameExplor = localStorage.getItem('projectName') || 'Unknown Project';
    // Initialize the main tour container content
    tourContainer.innerHTML = `
    <div id="tour-ui-wrapper" style="display: none; height: 100%; display: flex; justify-content: center; align-items: center;">
      <div class="tour-wrapper" style="text-align: center; max-width: 600px; width: 100%;">
        <h1 class="tour-title" style="font-family: 'Aldrich', sans-serif; font-size: 2rem; margin-bottom: 0.5rem;">Exploration Tours</h1>
        <h2 class="tour-subtitle">Project: ${projectNameExplor}</h2>
        <p class="tour-description" style="font-family: 'Poppins', sans-serif; font-size: 1rem; color: #ccc; margin-bottom: 2rem;">
          Take a tour of the codebase to understand how the project is structured.
        </p>

        <h2 class="section-heading" style="font-family: 'Aldrich', sans-serif; font-size: 1rem; margin-bottom: 1.2rem;">Create a tour, now.</h2>
  
        <!-- Exploratory Tours Section -->
        <div class="tour-section">
          <div class="border-animated-container" style="margin-bottom: 1.5rem;">
            <button id="new-exploratory-tour" class="create-tour-button">New Exploration</button>
          </div>
          <ul id="exploratory-tours-list" class="tour-list" style="list-style: none; padding: 0; color: #aaa;">
            <li>No exploratory tours yet.</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  document.getElementById('exit-podcast')?.addEventListener('click', () => {
        clearAllViews();

        const prevEl = document.getElementById(prev);
        if (prevEl) {
            prevEl.style.display = 'block';
            prevEl.classList.add('active');

            // Also restore tab highlight if necessary
            if (prev === 'tour-container') {
                document.getElementById('tours-tab').classList.add('active');
                document.getElementById('tours-content').classList.add('active');
            } else if (prev === 'my-tours-container') {
                document.getElementById('my-tours-tab').classList.add('active');
                document.getElementById('my-tours-content').classList.add('active');
            }
        }

        document.getElementById('podcast-page').style.display = 'none';
        document.getElementById('podcast-page').classList.remove('active');
    });
  
    // Initialize the guided tour creation form
    guidedTourCreationContainer.innerHTML = `
    <div class="guidedTourForm-wrapper" id="tour-creation-container">
       <h1 class="tour-title">New guided tour</h1>
       <p class="tour-form-method"><strong>AI assisted</strong> · Pick files; Lacy writes the steps.</p>
       <form id="guided-tour-form">
          <!-- SECTION: Tour Setup -->
          <div class="form-section">
             <h2 class="section-heading">Tour Setup</h2>
             <label for="tour-name" class="form-subtitle">Tour Name</label>
             <input type="text" id="tour-name" class="form-input" placeholder="Enter a tour title" required>
             <label for="file-explorer" class="form-subtitle">Tour Files</label>
             <div id="file-explorer-guided" class="file-explorer"></div>
             <p id="guided-file-selection-error" class="error-message" style="color: red; display: none;">Please select at least one file.</p>
             <label for="tour-focus" class="form-subtitle">Tour Focus</label>
             <input type="text" id="tour-focus" class="form-input" placeholder="e.g., Features, Onboarding" required>
             <label for="guided-llm-model" class="form-subtitle">AI Model</label>
             <select id="guided-llm-model" class="form-input">
                <option value="">Loading models…</option>
            </select>
             <label for="guided-language" class="form-subtitle">Tour Language</label>
             <select id="guided-language" class="form-input">
                <option value="en" selected>English</option>
             </select>
          </div>
          <!-- SECTION: Audience -->
          <div class="form-section">
             <h2 class="section-heading">Audience</h2>
             <label class="form-subtitle">Target Department</label>
             <div class="pill-radio-group" id="target-department">
                <!-- filled from the server by renderDepartmentOptions -->
             </div>
             <p id="target-department-error" class="error-message" style="color: red; display: none;"></p>
             <br>
             <label for="project-knowledge" class="form-subtitle">Project Knowledge Level</label>
             <select id="guided-project-knowledge" class="form-input">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
             </select>
             <p id="guided-knowledge-description" class="description-text">
                Audience needs guidance or onboarding to understand the project.
             </p>
          </div>
          <!-- SECTION: Additional Features -->
          <div class="form-section">
             <h2 class="section-heading">Additional Features</h2>
             <div class="highlight-box">
                <div class="toggle-row">
                   <label class="form-label toggle-label" for="quiz-toggle"><strong>🧠 Create Quiz for this codebase tour?</strong></label>
                   <label class="switch">
                   <input type="checkbox" id="quiz-toggle" name="guided-quiz-creation">
                   <span class="slider round"></span>
                   </label>
                </div>
             </div>
            <div class="toggle-row" hidden>
                <label class="form-label toggle-label" for="podcast-toggle">
                <strong>🎙️ Create Podcast for this codebase tour?</strong>
                </label>
                <label class="switch">
                <input type="checkbox" id="podcast-toggle" name="guided-podcast-creation">
                <span class="slider round"></span>
                </label>
            </div>
          </div>
          <!-- Buttons -->
            <div class="tour-form-button-container">
            <button type="button" class="tour-cancel-button" id="back-to-tours">Back</button>
            <button type="submit" class="tour-submit-button" id="guided-tour-form-submit">Create Tour</button>
            </div>
       </form>
    </div>
    `;

    exploratoryTourCreationContainer.innerHTML = `
    <div class="explorationTourForm-wrapper" id="explor-tour-creation-container">
      <h1 class="tour-title">New exploration</h1>
      <p class="tour-form-method"><strong>Just for you</strong> · Ask about part of the code; Lacy walks you through it.</p>
      <form id="explor-tour-form">

        <div class="form-section">
          <h2 class="section-heading">Tour Setup</h2>
          <label for="file-explorer-exploratory" class="form-subtitle">Tour Files</label>
          <div id="file-explorer-exploratory" class="file-explorer"></div>
          <p id="explor-file-selection-error" class="error-message" style="color: red; display: none;">Please select at least one file.</p>
          <label for="explor-tour-focus" class="form-subtitle">Tour Focus</label>
          <input type="text" id="explor-tour-focus" class="form-input" placeholder="What would you like to know?" required>
  
          <label for="explor-llm-model" class="form-subtitle">AI Model</label>
          <select id="explor-llm-model" class="form-input">
                <option value="">Loading models…</option>
            </select>
          <label for="explor-language" class="form-subtitle">Tour Language</label>
          <select id="explor-language" class="form-input">
                <option value="en" selected>English</option>
             </select>
  
          <label for="explor-project-knowledge" class="form-subtitle">Project Knowledge Level</label>
          <select id="explor-project-knowledge" class="form-input">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <p id="explor-knowledge-description" class="description-text">
            I'm new to the codebase and need guidance.
          </p>
        </div>

        <div class="form-section">
          <h2 class="section-heading">Additional Features</h2>
          <div class="highlight-box">
            <div class="toggle-row">
              <label class="form-label toggle-label" for="explor-quiz-toggle"><strong>🧠 Create Quiz for this codebase tour?</strong></label>
              <label class="switch">
                <input type="checkbox" id="explor-quiz-toggle" name="explor-quiz-creation">
                <span class="slider round"></span>
              </label>
            </div>
          </div>
        </div>
  
        <!-- Buttons -->
        <div class="tour-form-button-container tour-form-actions">
          <button type="button" class="tour-cancel-button" id="explor-back-to-tours">Back</button>
          <button type="submit" class="tour-submit-button" id="exploratory-tour-form-submit">Create Tour</button>
        </div>
      </form>
    </div>
  `;  

    renderDepartmentOptions('target-department', { name: 'audience', idPrefix: 'audience' }).then(wireDepartmentRadios);

    function wireDepartmentRadios() {
    document.querySelectorAll('#target-department input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const departmentError = document.getElementById('target-department-error');
            const departmentContainer = document.getElementById('target-department');
    
            departmentError.textContent = '';
            departmentError.style.display = 'none';
            departmentContainer.style.border = 'none';
            departmentContainer.style.padding = '0';
        });
    });
    }

    //may need to add quiz-edit here explicitly
    document.getElementById('explor-tour-form').addEventListener('input', () => {
        formIsDirty = true;
    });

    document.getElementById('guided-tour-form').addEventListener('input', () => {
        formIsDirty = true;
    });

    const exploratoryToursList = document.getElementById('exploratory-tours-list');
    
    const newExploratoryTourButton = document.getElementById('new-exploratory-tour');
    newExploratoryTourButton.addEventListener('click', ()=> {
        tourContainer.style.display= 'none';
        exploratoryTourCreationContainer.style.display='block';
        clearSelections();
        createFileExplorer(projectFiles, "file-explorer-exploratory");
        populateTourOptions({ modelSelectId: 'explor-llm-model', languageSelectId: 'explor-language', submitButtonId: 'exploratory-tour-form-submit' });
        }
    );

    const backToToursButton = document.getElementById('back-to-tours');
    backToToursButton.addEventListener('click', async () => {
        const confirmed = await confirmLeaveIfDirty();
        if (!confirmed) return;

        document.getElementById('guided-tour-form').reset();
        formIsDirty = false;
        clearAllViews();
        document.getElementById('my-tours-container').style.display = 'block';
        document.getElementById('my-tours-content').classList.add('active');
        clearSelections(); 
        window.scrollTo({ top: 0, behavior: 'auto' });
    });

    const explorBackToToursButton = document.getElementById('explor-back-to-tours');
    explorBackToToursButton.addEventListener('click', async () => {
        const confirmed = await confirmLeaveIfDirty();
        if (!confirmed) return;

        document.getElementById('explor-tour-form').reset();
        formIsDirty = false;
        clearAllViews();
        document.getElementById('tour-container').style.display = 'block';
        clearSelections(); 
    });
    
    function clearSelections() {
        
        selectedFiles.clear(); 
        selectedFileParts.clear(); // Clear the selected file parts
        document.querySelectorAll('.file.partial-selected').forEach(el => {
            el.classList.remove('partial-selected');
            const button = el.querySelector('.details-button');
            if (button) button.textContent = '⚙️';
        });
    
        const guidedExplorer = document.getElementById('file-explorer-guided');
        if (guidedExplorer) guidedExplorer.innerHTML = '';
        
        const exploratoryExplorer = document.getElementById('file-explorer-exploratory');
        if (exploratoryExplorer) exploratoryExplorer.innerHTML = '';

        const fileTags = document.getElementById('file-tags');
        if (fileTags) fileTags.innerHTML = '';
        
        const explorFileTags = document.getElementById('explor-file-tags');
        if (explorFileTags) explorFileTags.innerHTML = '';
    }
    
        const knowledgeSelect = document.getElementById("explor-project-knowledge");
    const descriptionText = document.getElementById("explor-knowledge-description");
    function updateKnowledgeDescription(level) {
        const descriptions = {
        low: "I'm new to the codebase and need guidance.",
        medium: "I know the basics and want to explore deeper.",
        high: "I’m familiar with the design and implementation details."
        };
        descriptionText.textContent = descriptions[level];
    }
    updateKnowledgeDescription(knowledgeSelect.value);
    knowledgeSelect.addEventListener("change", () => {
        updateKnowledgeDescription(knowledgeSelect.value);
    });

    // Add an event listener to the select box guided
    const guidedLevel = document.getElementById('guided-project-knowledge');
    guidedLevel.addEventListener('change', () => {
        const guidedDesc = document.getElementById('guided-knowledge-description');
        const knowledgeExplanations = {
            low: "You need guidance or onboarding to understand the project.",
            medium: "You know the main workflows but might need clarification for details.",
            high: "You have a deep understanding of the project's architecture and can debug or explain its workflows."
        };
        const selectedValue = guidedLevel.value; // Get selected value
        guidedDesc.textContent = knowledgeExplanations[selectedValue]; // Update explanation
        guidedDesc.style.display='block';
    });

    //EXPLORATION TOUR _ TOUR CREATION
    document.getElementById('explor-tour-form').addEventListener('submit', async (e) =>{
        e.preventDefault();
        formIsDirty = false;

        const tour_focus = document.getElementById('explor-tour-focus').value;
        const projectKnowledge = document.getElementById('explor-project-knowledge').value;
        const llmModel = document.getElementById('explor-llm-model').value;
        const language = document.getElementById('explor-language').value;
        const user = JSON.parse(localStorage.getItem('user')); // Parse the string into an object
        const userId = user?.id; // Safely access the `id` property
        const quizToggle = document.getElementById("explor-quiz-toggle");
        const createQuiz = quizToggle && quizToggle.checked;
        //Devam edilecek fe input ları alınabilir

        if (selectedFiles.size === 0) {
            const errorElem = document.getElementById('explor-file-selection-error');
            const explorer = document.querySelector('.file-explorer');
        
            if (errorElem && explorer) {
                errorElem.style.display = 'block';
                explorer.style.border = '2px solid red';
                explorer.style.padding = '10px';
            }
        
            return; 
        }

        const tourData= {
            name: null,
            files: Array.from(selectedFiles),
            file_contents: await requestProjectFileContents(Array.from(selectedFiles)),
            tour_focus: tour_focus,
            file_parts: Object.fromEntries(selectedFileParts), 
            llmModel: llmModel,
            isGuided: 0,
            targetDepartment: null,
            create_Quiz: createQuiz,
            projectKnowledge: projectKnowledge,
            language: language,
            user_id: userId, // Example user_id, replace with dynamic data if needed, session info should come here
            basePath: basePath, // Include the base path in the payload
            projectName: projectName,
            projectKey: projectKey
        }

        try {
            // Make API call to save the tour
            setTourCreationBusy(true);
            const response = await fetch(`${window.LACY_API_URL}/api/create-tour`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tourData)
            });
            if (response.ok) {
                const result = await response.json();
                if (result.podcastError) {
                    vscode.postMessage({
                        command: 'showError',
                        text: `The tour was created, but the podcast could not be generated: ${result.podcastError}`
                    });
                }
                alert('Tour created successfully!');
                if(result.quizQuestions !=undefined){
                saveQuizToDatabase(result.quizQuestions, result.tourId);
                }
                // Optionally redirect or update the UI
                //window.location.reload();
                document.getElementById('explor-tour-form').reset();
                document.getElementById('loading-tour').style.display = 'none';
                document.querySelectorAll('button').forEach(btn => btn.disabled = false);

                clearAllViews();
                formIsDirty = false;
                document.getElementById('tour-container').style.display = 'block';
                await fetchExplorationTours(result.tourId);

            } else {
                let errorText = `Failed to create tour. (Status ${response.status})`;

                try {
                    const errorBody = await response.json();

                    if (errorBody) {
                        errorText = errorBody.error || errorBody.message || errorText;

                        // ✅ This is the correct check
                        if (errorBody.tourId) {
                            vscode.postMessage({
                                command: 'deleteTour',
                                tour_id: errorBody.tourId,
                                tour_type: "exploration"
                            });
                        }
                    }
                } catch {
                    const text = await response.text();
                    if (text) errorText = text;
                }

                vscode.postMessage({
                    command: 'showError',
                    text: errorText
                });
            }

        } catch (error) {
            vscode.postMessage({
                command: 'showError',
                text: 'An unexpected error occurred. Please check your connection or console.'
            });
        } finally {
            setTourCreationBusy(false);
        }
    });

    //GUIDED TOUR _ TOUR CREATION
    const guidedTourForm = document.getElementById('guided-tour-form');
    document.getElementById('guided-tour-form').addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent default form submission behavior
        formIsDirty = false;

        const name = document.getElementById('tour-name').value;
        const tour_focus = document.getElementById('tour-focus').value;
        const projectKnowledge = document.getElementById('guided-project-knowledge').value;
        const language = document.getElementById('guided-language').value;
        const quizToggle = document.getElementById("quiz-toggle");
        const createQuiz = quizToggle && quizToggle.checked;
        const podcastToggle = document.getElementById("podcast-toggle");
        const createAudio = podcastToggle && podcastToggle.checked;
        
        const departmentContainer = document.getElementById('target-department');
        const departmentError = document.getElementById('target-department-error');
        const selectedRadio = departmentContainer.querySelector('input[type="radio"]:checked');
        
        if (selectedFiles.size === 0) {
            const errorElem = document.getElementById('guided-file-selection-error');
            const explorer = document.querySelector('.file-explorer');
        
            if (errorElem && explorer) {
                errorElem.style.display = 'block';
                explorer.style.border = '2px solid red';
                explorer.style.padding = '10px';
            }
        
            return; 
        }

        if (!selectedRadio) {
            departmentError.textContent = "Please select a target department.";
            departmentError.style.display = 'block';
            departmentContainer.style.border = '2px solid red';
            departmentContainer.style.padding = '10px';
            return;
        } else {
            departmentError.textContent = '';
            departmentError.style.display = 'none';
            departmentContainer.style.border = 'none';
            departmentContainer.style.padding = '0';
        }

        const targetDepartment = selectedRadio.value;

        const llmModel = document.getElementById('guided-llm-model').value;

        const user = JSON.parse(localStorage.getItem('user')); // Parse the string into an object
        const userId = user?.id; // Safely access the `id` property
            // Prepare the data payload
        const tourData = {
            name: name,
            files: Array.from(selectedFiles),
            file_contents: await requestProjectFileContents(Array.from(selectedFiles)),
            file_parts: Object.fromEntries(selectedFileParts), 
            llmModel: llmModel,
            tour_focus: tour_focus,
            isGuided: 1,
            targetDepartment: targetDepartment,
            create_Quiz: createQuiz,
            create_audio: createAudio,
            projectKnowledge: projectKnowledge,
            language: language,
            user_id: userId, // Example user_id, replace with dynamic data if needed, session info should come here
            basePath: basePath, // Include the base path in the payload
            projectName: projectName,
            projectKey: projectKey
        };
    
        try {

            // Make API call to save the tour
            setTourCreationBusy(true);
            const response = await fetch(`${window.LACY_API_URL}/api/create-tour`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tourData)
            });
            if (response.ok) {
                const result = await response.json();
                warnIfNobodyAssigned(result);

                if (result.podcastError) {
                    vscode.postMessage({
                        command: 'showError',
                        text: `The tour was created, but the podcast could not be generated: ${result.podcastError}`
                    });
                }
                alert('Tour created successfully!');
                clearAllViews();
                //expert has decided there would a quiz for this tour
                if(result.quizQuestions) {
                    document.getElementById('loading-tour').style.display = 'none';
                    const quizEditContainer = document.getElementById('quiz-edit-container');
                    quizEditContainer.style.display = 'block';
                    try {
                        document.getElementById('guided-tour-form').reset();
                        document.querySelectorAll('button').forEach(btn => btn.disabled = false);
                        
                        await renderQuizEditor(result.quizQuestions, result.tourId); // Wait for the quiz editor to render and the quiz to be saved
                    } catch (error) {
                        return; // Stop further execution if there is an error
                    }
                    await loadUsersGuidedTours();
                    document.getElementById('my-tours-container').style.display = 'block';
                    document.getElementById('my-tours-content').classList.add('active');
                } 
                else{
                    // Optionally redirect or update the UI
                    //window.location.reload();
                    clearAllViews();
                    await loadUsersGuidedTours();
                    document.getElementById('guided-tour-form').reset();
                    document.querySelectorAll('button').forEach(btn => btn.disabled = false);
                    document.getElementById('my-tours-container').style.display = 'block';
                    document.getElementById('my-tours-content').classList.add('active');
                    document.getElementById('loading-tour').style.display = 'none';
                     // Refresh tours list
                }   
                
            } else {
                let errorText = `Failed to create tour. (Status ${response.status})`;

                try {
                    const errorBody = await response.json();

                    if (errorBody) {
                        errorText = errorBody.error || errorBody.message || errorText;

                        // ✅ This is the correct check
                        if (errorBody.tourId) {
                            vscode.postMessage({
                                command: 'deleteTour',
                                tour_id: errorBody.tourId,
                                tour_type: "guided"
                            });
                        }
                    }
                } catch {
                    const text = await response.text();
                    if (text) errorText = text;
                }

                vscode.postMessage({
                    command: 'showError',
                    text: errorText
                });
            }
        } catch (error) {
            vscode.postMessage({
                command: 'showError',
                text: 'An unexpected error occurred. Please check your connection or console.'
            });
        } finally {
            setTourCreationBusy(false);
        }
    });
  
    function createFileExplorer(projectFiles, containerId) {
        const fileExplorer = document.getElementById(containerId);
        if (!fileExplorer) return;
    
        fileExplorer.innerHTML = '';
        
        // Create a file tree from the projectFiles array
        const fileTree = buildFileTree(projectFiles);
        
        const treeView = renderTree(fileTree, '', true);
        fileExplorer.appendChild(treeView);
    }
      
    // Now your existing renderTree can be updated to show 'functions':
    function renderTree(tree, parentPath = '', isRoot = false) {
        const ul = document.createElement('ul');
        
        // Only keep the top-level visible by default
        if (!isRoot) {
            ul.classList.add('hidden');  // Collapse subdirectories
        }
    
        // Get the keys of the tree object
        const keys = Object.keys(tree).sort((a, b) => a.localeCompare(b));
        
        // Iterate through each key
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const li = document.createElement('li');
            const fullPath = parentPath ? `${parentPath}/${key}` : key;
    
            if (tree[key].file) {
                // Create a container for the file item and buttons
                const fileContainer = document.createElement('div');
                fileContainer.className = 'file-container';
                
                // File name
                const fileName = document.createElement('span');
                fileName.textContent = key;
                fileName.className = 'file-name';
                fileContainer.addEventListener('click', () => toggleFileSelection(li, fullPath));
                
                // "Select Details" button
                const detailsButton = document.createElement('button');
                detailsButton.textContent = '⚙️'; // Gear icon
                detailsButton.className = 'details-button';
                detailsButton.title = 'Select specific parts of this file';
                detailsButton.addEventListener('click', (e) => {
                    e.preventDefault(); 
                    e.stopPropagation();

                    if (selectedFiles.size >= 5 && !selectedFiles.has(fullPath)) {
                        vscode.postMessage({
                            command: 'showError',
                            text: 'You can only select up to 5 files. Please deselect a file first before adding file parts.'
                        });
                        return;
                    }

                    openFileDetailSelector(
                        fullPath,
                        guidedTourCreationContainer.style.display === 'block'
                            ? 'guidedTourForm-container'
                            : 'explorTourForm-container'
                    );
                });
                
                // Add elements to container
                fileContainer.appendChild(fileName);
                fileContainer.appendChild(detailsButton);
                
                li.appendChild(fileContainer);
                li.classList.add('file');
                li.dataset.path = fullPath;
            } else {
                const span = document.createElement('span');
                span.textContent = key;
                span.classList.add('folder');
                span.addEventListener('click', () => {
                    const nestedUl = li.querySelector('ul');
                    if (nestedUl) nestedUl.classList.toggle('hidden');
                });
    
                li.appendChild(span);
                
                // Create a new tree for the subdirectory
                const childTree = renderTree(tree[key], fullPath, false);
                li.appendChild(childTree);
            }
    
            ul.appendChild(li);
        }
    
        return ul;
    }
    
    function openFileDetailSelector(filePath, previousContainerId) {
        // Hide main tour containers
    
        clearAllViews();
        
        // Create or show the file detail selector container
        let detailSelectorContainer = document.getElementById('file-detail-selector');
        if (!detailSelectorContainer) {
            detailSelectorContainer = document.createElement('div');
            detailSelectorContainer.id = 'file-detail-selector';
            document.body.appendChild(detailSelectorContainer);
        }
        
        // Reset container content
        detailSelectorContainer.style.display = 'block';
        
        // Create UI for the file detail selector
        detailSelectorContainer.innerHTML = `
            <div class="detail-selector-wrapper" style="padding: 1.5rem; font-family: 'Poppins', sans-serif;">
                <h2 style="font-family: 'Aldrich', sans-serif; font-size: 1.5rem; margin-bottom: 5px;">Select Parts of File:</h2>
                <p class="file-path" style="font-family: 'Aldrich', sans-serif; font-size: 1rem; margin-bottom: 1rem;">
                ${filePath}
                </p>
                
                <div class="line-range-selector">
                    <h3 style="margin-bottom: 8px;">Add Line Range</h3>
                    <div class="range-inputs">
                        <div class="input-group">
                            <label for="line-start">Start Line:</label>
                            <input type="number" id="line-start" min="1" value="1">
                        </div>
                        <div class="input-group">
                            <label for="line-end">End Line:</label>
                            <input type="number" id="line-end" min="1" value="1">
                        </div>
                    </div>
                    <div class="input-group description-input">
                        <label for="range-description">Description:</label>
                        <textarea id="range-description" placeholder=""></textarea>
                    </div>
                    <div class="range-button-wrapper">
                        <p id="range-error" style="color: #ff4d4f; font-size: 0.9rem; margin-top: 5px;"></p>
                        <button id="add-range-button" class="add-button">Add Range</button>
                    </div>
                </div>
                
                <div class="selected-ranges">
                    <h3 style="margin-bottom: 8px;">Selected Ranges</h3>
                    <ul id="selected-ranges-list">
                        ${getSelectedRangesForFile(filePath)}
                    </ul>
                </div>
                
                <div class="button-container" style="display: flex; justify-content: flex-start; margin-top: 1rem;">
                    <button id="back-to-form" class="tour-cancel-button">Back</button>
                </div>
            </div>
        </div>
        `;
    
        updateSelectedRangesList(filePath);
        
        vscode.postMessage({
            command: 'updateSelectedFile',
            filePath: filePath
        });
        
        document.getElementById('add-range-button').addEventListener('click', () => {
            addLineRange(filePath);
        });

        const descInput = document.getElementById('range-description');
        if (descInput) {
            if (previousContainerId === 'guidedTourForm-container') {
                descInput.placeholder = "Describe what this code section does...";
            } else if (previousContainerId === 'explorTourForm-container') {
                descInput.placeholder = "Which specific part do you want to focus on?";
            }
        }
        
        document.getElementById('back-to-form').addEventListener('click', () => {
            saveDetailSelection(filePath)
            clearAllViews();
            document.getElementById(previousContainerId).style.display = 'block';
            /*vscode.postMessage({
                command: 'closeActiveEditor'
            });*/
        });
    
    }
    
    function addLineRange(filePath) {
        const startLine = parseInt(document.getElementById('line-start').value);
        const endLine = parseInt(document.getElementById('line-end').value);
        const description = document.getElementById('range-description').value.trim();
        const maxLines = parseInt(document.getElementById('line-end').max); // absent unless a file is previewed
        const errorElem = document.getElementById('range-error');

        // Validate inputs
        if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine) {
            errorElem.textContent = 'Please enter a valid line range, where start ≤ end.';
            return;
        }
        if (!isNaN(maxLines) && endLine > maxLines) {
            errorElem.textContent = `This file has ${maxLines} lines; please choose a range inside it.`;
            return;
        }
    
        errorElem.textContent = '';
        
        // Add to the selected parts
        if (!selectedFileParts.has(filePath)) {
            selectedFileParts.set(filePath, []);
        }
        
        const parts = selectedFileParts.get(filePath);
        parts.push({
            start: startLine,
            end: endLine,
            description: description
        });
        
        // Update the UI
        updateSelectedRangesList(filePath);
        
        // Clear inputs for next range
        document.getElementById('range-description').value = '';
    }
    
function updateSelectedRangesList(filePath) {
    const rangesList = document.getElementById('selected-ranges-list');
    rangesList.innerHTML = getSelectedRangesForFile(filePath);
    
    // Add event listeners for delete buttons
    const deleteButtons = rangesList.querySelectorAll('.delete-range');
    deleteButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            selectedFileParts.get(filePath).splice(index, 1);
            updateSelectedRangesList(filePath);
        });
    });

    const rangeItems = rangesList.querySelectorAll('.range-item');
    rangeItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            // prevent conflict with delete button
            if (e.target.classList.contains('delete-range')) return;

            const lines = item.querySelector('.range-lines').textContent;
            const [start, end] = lines.match(/\d+/g).map(Number);
            vscode.postMessage({
                command: 'highlightInEditor',
                filePath,
                startLine: start,
                endLine: end
            });
        });
    });
}

function getSelectedRangesForFile(filePath) {
    if (!selectedFileParts.has(filePath) || selectedFileParts.get(filePath).length === 0) {
        return '<li class="no-ranges">No ranges selected yet</li>';
    }
    
    return selectedFileParts.get(filePath).map((range, index) => `
        <li class="range-item">
            <div class="range-info">
                <span class="range-lines">Lines ${range.start}-${range.end}</span>
                <p class="range-description">${range.description}</p>
            </div>
            <button class="delete-range" data-index="${index}">×</button>
        </li>
    `).join('');
}

function saveDetailSelection(filePath) {
    // Check if file parts were selected
    if (selectedFileParts.has(filePath) && selectedFileParts.get(filePath).length > 0) {
        // If the file is already selected, don't toggle it off
        if (!selectedFiles.has(filePath)) {
            selectedFiles.add(filePath);
        }
        
        // Update UI to show file has parts selected
        const fileElements = document.querySelectorAll(`li[data-path="${filePath}"]`);
        fileElements.forEach(el => {
            el.classList.add('selected'); // Ensure file is marked as selected
            el.classList.add('partial-selected');
            const button = el.querySelector('.details-button');
            if (button) {
                button.textContent = '🔍'; // Change gear to magnifying glass
            }
        });
    } else {
        // No parts selected, but make sure file is selected
        if (!selectedFiles.has(filePath)) {
            selectedFiles.add(filePath);
            // Update UI to show the file is selected
            const fileElements = document.querySelectorAll(`li[data-path="${filePath}"]`);
            fileElements.forEach(el => {
                el.classList.add('selected');
            });
        }
    }
}

// Modify your existing toggleFileSelection function to handle parts
function toggleFileSelection(element, filePath) {
    if (selectedFiles.has(filePath)) {
        selectedFiles.delete(filePath);
        element.classList.remove('selected');
        element.classList.remove('partial-selected');
        
        // Also remove any selected parts for this file
        if (selectedFileParts.has(filePath)) {
            selectedFileParts.delete(filePath);
        }

        const button = element.querySelector('.details-button');
        if (button) {
            button.textContent = '⚙️'; // Reset to gear
        }
    } else {
        if (selectedFiles.size >= 5) {
            vscode.postMessage({
                command: 'showError',
                text: 'You can only select up to 5 files.'
            });
            return;
        }
        selectedFiles.add(filePath);
        element.classList.add('selected');
        // Show the file in the editor too, so the expert sees what they picked.
        vscode.postMessage({ command: 'previewFile', filePath });

        if (selectedFiles.size > 0) {
            const errorElems = document.getElementsByClassName('error-message');
            const explorers = document.querySelectorAll('.file-explorer');
        
            for (let errorElem of errorElems) {
                errorElem.style.display = 'none';
            }
        
            explorers.forEach(explorer => {
                explorer.style.border = 'none';
                explorer.style.padding = '0';
            });
        }
        vscode.postMessage({
            command: 'updateSelectedFile',
            filePath: filePath,
            preview: true 
        });
    }
}

function clearAllViews() {
    const containers = [
        'tour-container',
        'guidedTourForm-container',
        'explorTourForm-container',
        'file-detail-selector',
        'my-tours-container'
    ];

    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    const tourStepContainer = document.getElementById('tour-step-container');
    if (tourStepContainer) {
        tourStepContainer.innerHTML = '';  // Clears the content
        tourStepContainer.style.display = 'none';  
    }
}

function resetTourForms() {
    document.getElementById('guided-tour-form')?.reset();
    document.getElementById('explor-tour-form')?.reset();
    formIsDirty = false;
    clearSelections();
}
    
});

function confirmLeaveIfDirty() {
    return new Promise((resolve) => {
        if (!formIsDirty) {
            resolve(true);
            return;
        }

        const overlay = document.getElementById('unsaved-warning-overlay');
        overlay.style.display = 'flex';

        const confirmBtn = document.getElementById('confirm-leave');
        const cancelBtn = document.getElementById('cancel-leave');

        const cleanup = () => {
            overlay.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
            formIsDirty = false;
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

//BURADA DOM CONTENT GELDİ
document.addEventListener('DOMContentLoaded', () => {
    const logoutTab = document.getElementById('logout-tab');
    if (logoutTab) {
        logoutTab.addEventListener('click', () => {
            showConfirmation(
                'Sign out of Lacy? Your tours and progress stay on the server.',
                'Sign out',
                'Cancel',
                () => logout()
            );
        });
    }
});

