let currentEditContainer = null;
let editableStep = {};
let newTour =false;
let newSteps=[];
let numberOfEditedSteps = 0;
let startTime = null;
let tourId= null;

function confirmLeaveIfDirty() {
    return new Promise((resolve) => {
        if (newSteps.length===0) {
            const myTours= document.getElementById('my-tours-tab');
            myTours.click();
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
            newSteps=[];
            cleanup();
            resolve(true);
            const myTours= document.getElementById('my-tours-tab');
            myTours.click();
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

function injectConfirmModal() {
    if (document.getElementById('confirm-delete-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'confirm-delete-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
        <div class="modal-box">
            <p>Are you sure you want to delete this step?</p>
            <div class="modal-buttons">
                <button id="confirm-delete-yes">Yes</button>
                <button id="confirm-delete-no">No</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Attach global listeners ONCE
    setTimeout(() => {
        const yesButton = document.getElementById('confirm-delete-yes');
        const noButton = document.getElementById('confirm-delete-no');
        
        if (yesButton) {
            yesButton.addEventListener('click', () => {
                const stepId = modal.getAttribute('data-step-id');
                modal.classList.add('hidden');
                numberOfEditedSteps += 1;
                currentEditContainer = null;

                const pending = newSteps.findIndex(s => String(s.id) === String(stepId));
                if (pending !== -1) {
                    // Not saved to the server yet: drop it from the draft only.
                    newSteps.splice(pending, 1);
                    newSteps.forEach((s, i) => { s.step_number = i + 1; s.id = i + 1; });
                    renderTourSteps(newSteps);
                    return;
                }

                vscode.postMessage({
                    command: 'deleteTourStep',
                    id: stepId
                });
            });
        }

        if (noButton) {
            noButton.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }
    }, 0);
}

function enableAllCards() {
    const allCards = document.querySelectorAll('.tour-card');
    allCards.forEach(card => {
        card.style.pointerEvents = 'auto';
    });
}

function newStepModal(stepNumber) {
    const oldModal = document.getElementById('new-step-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'new-step-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="step-sheet">
            <h1 class="tour-title create-step-header">Step ${stepNumber}</h1>
            <p class="tour-form-method">Pick a file, select the lines in the editor, then say what they do.</p>
            <div class="form-section">
                <h2 class="section-heading">File</h2>
                <div id="file-select-container"></div>
                <p id="selected-file-path">Selected file: None</p>
            </div>
            <div class="form-section" id="modal-editable-container"></div>
        </div>
    `;
    editableStep.filePath = null;
    editableStep.step= stepNumber;

    const selectedPath = document.getElementById('selected-file-path');
    if (selectedPath) selectedPath.textContent = 'Selected file: None';

    document.querySelectorAll('.file-container').forEach(el => el.classList.remove('selected-file'));

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const stepData = {
        id: null, // temporary; backend will assign actual ID
        step: stepNumber,
        startLine: 0,
        endLine: 0,
        content: ''
    };

    const editableContainer = modal.querySelector('#modal-editable-container');
    renderEditableTourStep(editableContainer, stepData, true);
}

function handleBackButtonClick(e){
    e.preventDefault();
    e.stopPropagation();

    const confirmed = confirmLeaveIfDirty();
    if (!confirmed) 
        return;
}

function handleCreateButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const selectedRadio = document.querySelector('input[name="audience"]:checked');
    const departmentError = document.getElementById('department-error');
    const departmentContainer = document.getElementById('target-department2');
    const nameError = document.getElementById('name-error');

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

    const tourName = document.getElementById('tour-name2')?.value;
    if (!tourName) {
        const tourNameInput = document.getElementById('tour-name2');
        tourNameInput.style.border = '2px solid red';
        nameError.style.display = 'block';
        nameError.style.color = 'red';
        nameError.textContent = "Please enter a tour name.";
        return;
    } else {
        nameError.textContent = '';
    }

    if(!newSteps.length) {
        const stepError = document.getElementById('step-error');
        stepError.textContent = 'Please add at least one step to the tour.';
        stepError.style.display = 'block';
        stepError.style.color = 'red';
        return;
    }

    const body = {
        name: tourName,
        target_department: selectedRadio.value,
        steps: newSteps
    };

    const data = {
        startTime: startTime,
        endTime: new Date().toISOString(),
        actionType: 'manualTourCreation',
        editNumber: numberOfEditedSteps
    };

    vscode.postMessage({ command: 'saveManualTour', body, data });
}

/*ECE NİN FOLDER FONKSİYONU*/
function createFileExplorer(projectFiles, containerId) {
    const fileExplorer = document.getElementById(containerId);
    if (!fileExplorer) return;

    fileExplorer.innerHTML = '';
    
    // Create a file tree from the projectFiles array
    const fileTree = buildFileTree(projectFiles);
    
    const treeView = renderTree(fileTree, '', true);
    fileExplorer.appendChild(treeView);
}

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
            fileContainer.addEventListener('click', () => {
                // Highlight selected file
                // Marked the same way as the AI assisted tree, so it looks the same.
                document.querySelectorAll('#new-step-modal .file-container').forEach(el => el.classList.remove('selected-file'));
                document.querySelectorAll('#new-step-modal li.file.selected').forEach(el => el.classList.remove('selected'));
                fileContainer.classList.add('selected-file');
                li.classList.add('selected');
            
                // Update selected path text
                const selectedPath = document.getElementById('selected-file-path');
                if (selectedPath) {
                    selectedPath.textContent = `${fullPath}`;
                    editableStep.file
                }
                vscode.postMessage({
                    command: 'updateSelectedFile',
                    filePath: fullPath
                });
                // (Optional) You can save this to global or send it somewhere
                editableStep.filePath = fullPath;
                document.querySelector('.start-line-input').value = 0;
                document.querySelector('.end-line-input').value = 0;
            });
            
            // Add elements to container
            fileContainer.appendChild(fileName);
            
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

async function fetchTourSteps(tourName) {
    try {
        const state = vscode.getState();
        const userId = state?.user?.id;

        if (!userId) {
            return [];
        }

        const encodedTourName = encodeURIComponent(tourName.trim());

        const response = await fetch(`${window.LACY_API_URL}/api/get-tour-steps?tourName=${encodedTourName}&userId=${userId}`);
        return await response.json();
    } catch (err) {
        return [];
    }
}

async function loadQuizAndOpenEditor(tourName, tourId, options = {}) {
  try {
    const resp = await fetch(`${window.LACY_API_URL}/api/get-quiz-questions?tourName=${encodeURIComponent(tourName)}`);
    if (!resp.ok) throw new Error(`Server ${resp.status}`);
    const quizQuestions = await resp.json();
    renderQuizEditor(Array.isArray(quizQuestions) ? quizQuestions : [], tourId, tourName, options);
  } catch (err) {
    // open editor with empty array so user can create questions
    renderQuizEditor([], tourId, tourName, options);
  }
}

function renderTourSteps(steps) {
    const container = document.getElementById('tour-steps-list-container');
    const header = container.querySelector('.tour-header-bar');
    container.innerHTML = '';
    if (header) container.appendChild(header);    
    steps.forEach((step) => {
        const card = document.createElement('div');
        card.className = 'tour-card';
        card.id = `tour-card-${step.step_number}`;
        card.dataset.id = step.id;
        container.appendChild(card);
        renderNonEditableTourCard(card, {
            id: step.id,
            step: step.step_number,
            startLine: step.line_start,
            endLine: step.line_end,
            filePath: step.file_path || step.file,
            content: step.description,
        });
    });
    if (newTour) {
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container tour-form-actions';
        buttonContainer.innerHTML = `
            <button type="button" id="back-to-tours" class="tour-cancel-button">Back</button>
            <button type="submit" id="tour-submit-button" class="tour-submit-button">Create Tour</button>
        `;
        // Inside the card, so the footer sits where it does on the other two forms.
        (container.querySelector('.newTourContainer') || container).appendChild(buttonContainer);
    
        setTimeout(() => {
            const createButton = document.getElementById('tour-submit-button');
            const backButton = document.getElementById('back-to-tours');
            if (createButton) {
                createButton.addEventListener('click', handleCreateButtonClick);
            }

            if (backButton) {
                backButton.addEventListener('click', handleBackButtonClick);
            }
        }, 0);
    }    
}

async function renderEditableTourStep(container, { id, step, startLine, endLine, content }, newStep) {
    if (!container) return;

    container.innerHTML = `
        ${newStep ? '' : `
        <div class="tour-card-header">
            <h2 id="step-title" class="step-title">Tour Step ${step}</h2>
            <button class="question-delete-button-edit">Delete</button>
        </div>
        `}
        <h2 class="section-heading">Lines</h2>
        <p class="step-lines">
            <input type="number" class="start-line-input" value="${startLine}" min="1" aria-label="First line">
            <span>to</span>
            <input type="number" class="end-line-input" value="${endLine}" min="1" aria-label="Last line">
        </p>
        <div class="step-description-header">
            <h2 class="section-heading">What happens here</h2>
            ${newStep ? '' : `
            <div class="recording-buttons">
                <button class="start-record" title="Say it instead of typing">Record</button>
                <button class="refresh-narration" title="Rewrite the text">Refresh</button>
            </div>`}
        </div>
        <textarea class="step-textarea" placeholder="Explain these lines to someone new to the code.">${content}</textarea>
        <div class="tour-nav">
            <button class="discard-button-edit">Discard</button>
            <button class="save-button-edit">Save</button>
        </div>
    `;

    const saveButton = container.querySelector('.save-button-edit');
    const discardButton = container.querySelector('.discard-button-edit');
    const textarea = container.querySelector('.step-textarea');
    const startInput = container.querySelector('.start-line-input');
    const endInput = container.querySelector('.end-line-input');

    const syncEditableStep = () => {
        editableStep.startLine= parseInt(startInput.value, 10);
        editableStep.endLine=parseInt(endInput.value, 10);
        editableStep.content= textarea.value;
    };

    textarea.addEventListener('input', syncEditableStep);
    startInput.addEventListener('input', syncEditableStep);
    endInput.addEventListener('input', syncEditableStep);

    saveButton?.addEventListener('click', () => {
        document.body.style.overflow = '';
        const updatedStartLine = parseInt(startInput.value, 10);
        const updatedEndLine = parseInt(endInput.value, 10);
        const updatedContent = textarea.value;

        syncEditableStep();
        if(updatedContent==="" || updatedEndLine===0 || updatedStartLine===0){
            const errorMessage = document.createElement('div');
            errorMessage.textContent = 'Please fill all of the sections.';
            errorMessage.style.position = 'fixed';
            errorMessage.style.top = '20px';
            errorMessage.style.left = '50%';
            errorMessage.style.transform = 'translateX(-50%)';
            errorMessage.style.backgroundColor = '#f44336';
            errorMessage.style.color = '#fff';
            errorMessage.style.padding = '10px 20px';
            errorMessage.style.borderRadius = '5px';
            errorMessage.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
            errorMessage.style.zIndex = '1000';
            document.body.appendChild(errorMessage);

            setTimeout(() => {
                errorMessage.style.transition = 'opacity 1s';
                errorMessage.style.opacity = '0';
                setTimeout(() => {
                    errorMessage.remove();
                }, 1000);
            }, 2000);
            return;
        }

        if(!newTour){
            if(!newStep){
                const body = {
                    description: updatedContent,
                    line_start: updatedStartLine,
                    line_end: updatedEndLine
                };
        
                vscode.postMessage({ command: 'saveTourStepInList', id, body });
                numberOfEditedSteps += 1;

                const nonEditContainer = document.createElement('div');
                nonEditContainer.className = 'tour-card';
                nonEditContainer.id = `tour-card-${step}`;
                container.replaceWith(nonEditContainer);
                renderNonEditableTourCard(nonEditContainer, { id, step, startLine: updatedStartLine, endLine: updatedEndLine, content: updatedContent });
                currentEditContainer = null;
                enableAllCards();
            }
            else{
                const body = {
                    step_number: step,
                    description: updatedContent,
                    file_path: editableStep.filePath,
                    line_start: updatedStartLine,
                    line_end: updatedEndLine,
                    created_at: new Date().toISOString()
                }
                vscode.postMessage({command: 'createTourStep', body});
                numberOfEditedSteps += 1;
            }

        }
        else{
            if(newStep){
                // Create a new step for new tour
                const body = {
                    id: step,
                    step_number: step,
                    description: updatedContent,
                    file_path: editableStep.filePath,
                    line_start: updatedStartLine,
                    line_end: updatedEndLine,
                    created_at: new Date().toISOString()
                }
                newSteps.push(body);
                const modal = document.getElementById('new-step-modal');
                if (modal) {
                    editableStep.filePath = null;
                    currentEditContainer = null;
                    modal.remove();
                    setTimeout(() => {
                        renderTourSteps(newSteps);
                    }, 100);
                }

                vscode.postMessage({command: 'createTourStepManual', body});
            }
            else{
                //Edit the existing step of the new tour
                const body = {
                    description: updatedContent,
                    line_start: updatedStartLine,
                    line_end: updatedEndLine,
                }

                //Change in the newSteps
                const stepIndex = newSteps.findIndex(step => String(step.id) === String(id));
                if (stepIndex !== -1) {
                    newSteps[stepIndex].description = updatedContent;
                    newSteps[stepIndex].line_start = updatedStartLine;
                    newSteps[stepIndex].line_end = updatedEndLine;
                }

                //Change in the parsedRows of extension
                vscode.postMessage({command: "saveTourStepManual", id: id, body: body});

                //UI changes
                const nonEditContainer = document.createElement('div');
                nonEditContainer.className = 'tour-card';
                nonEditContainer.id = `tour-card-${step}`;
                container.replaceWith(nonEditContainer);
                renderNonEditableTourCard(nonEditContainer, { id, step, startLine: updatedStartLine, endLine: updatedEndLine, content: updatedContent });
                currentEditContainer = null;
                enableAllCards();
            }
        }
    });

    discardButton?.addEventListener('click', () => {
        document.body.style.overflow = '';
        if(!newStep){
            const nonEditCard = document.createElement('div');
            nonEditCard.className = 'tour-card';
            nonEditCard.id = `tour-card-${step}`;
            container.replaceWith(nonEditCard);
            renderNonEditableTourCard(nonEditCard, { id, step, startLine, endLine, content });
            currentEditContainer = null;
            enableAllCards();
        }
        else{
            const modal = document.getElementById('new-step-modal');
            if (modal) {
                modal.remove();
                editableStep.filePath = null;
                currentEditContainer = null;
            }
        } 
    });

    const questionDeleteButton = container.querySelector('.question-delete-button-edit');
    questionDeleteButton?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const modal = document.getElementById('confirm-delete-modal');
        if (modal) {
            modal.setAttribute('data-step-id', id); // store the ID temporarily
            modal.classList.remove('hidden');
        }
    });

    // Recording happens in the browser page opened by createTourRecord; it saves the
    // transcript to the step, and "refresh" pulls the updated description back here.
    const startButton = container.querySelector('.start-record');
    startButton?.addEventListener('click', () => {
        vscode.postMessage({
            command: 'createTourRecord',
            stepId: id
        });
    });

    const refreshButton = container.querySelector('.refresh-narration');
    refreshButton?.addEventListener('click', () => {
        vscode.postMessage({
            command: 'updateTourStepWithTranscription',
            stepIndex: id
        });
    });

    syncEditableStep();
}

function renderNonEditableTourCard(container, { id, step, startLine, endLine, content, filePath }) {
    if (!container) return;

    const safeContent = content || '';
    // After an edit the caller may not know the file; the card it replaces does.
    const path = filePath || container.dataset?.filePath
        || document.getElementById(`tour-card-${step}`)?.dataset.filePath || editableStep?.filePath || '';
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.id = `tour-card-${step}`;
    card.dataset.id = id;
    card.dataset.step = step;
    card.dataset.startLine = startLine;
    card.dataset.endLine = endLine;
    card.dataset.content = safeContent;
    card.dataset.filePath = path;


    const fileName = path.split('/').pop();
    const lines = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;

    card.innerHTML = `
        <div class="tour-card-header">
            <button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)"
                    aria-label="Reorder step ${step}">⋮⋮</button>
            <h2>Step ${step}</h2>
            <span class="tour-card-where" title="${escapeHtml(path)}">${fileName ? `${escapeHtml(fileName)} · ` : ''}${lines}</span>
            <button type="button" class="step-edit-button" data-step="${step}" title="Edit step" aria-label="Edit step ${step}">✎</button>
        </div>
        <p class="tour-card-explanation">${escapeHtml(safeContent) || '<em>No description yet.</em>'}</p>
    `;

    container.replaceWith(card);

    card.addEventListener('click', (e) => {
        // Reordering is not a request to edit.
        if (e.target.closest('.drag-handle') || card.dataset.justDragged) return;
        if(!currentEditContainer) {
            vscode.postMessage({
            command: 'editTourStep',
            stepIndex: step
        });
        }
    });

    card.querySelector('.step-edit-button')?.addEventListener('click', () => {
        const allCards = document.querySelectorAll('.tour-card');
        allCards.forEach(otherCard => {
            if (otherCard !== card) {
                otherCard.style.pointerEvents = 'none';
            }
        });

        /*if (currentEditContainer) {
            const textarea = currentEditContainer.querySelector('.step-textarea');
            const startInput = currentEditContainer.querySelector('.start-line-input');
            const endInput = currentEditContainer.querySelector('.end-line-input');

            if (textarea && startInput && endInput) {
                const updatedStep = {
                    id: editableStep.id,
                    step: editableStep.step,
                    startLine: parseInt(startInput.value, 10),
                    endLine: parseInt(endInput.value, 10),
                    content: textarea.value
                };

                const restored = document.createElement('div');
                restored.className = 'tour-card';
                restored.id = `tour-card-${updatedStep.step}`;
                currentEditContainer.replaceWith(restored);
                renderNonEditableTourCard(restored, updatedStep);
            }
        }*/
        
        card.click();

        const editContainer = document.createElement('div');
        editContainer.id = 'tour-step-edit-container';
        currentEditContainer = editContainer;
        card.replaceWith(editContainer);

        renderEditableTourStep(editContainer, { id, step, startLine, endLine, content }, false);
        container.querySelectorAll('.tour-card').forEach(otherCard => {
            if (otherCard !== card) {
                otherCard.style.cursor = 'default';
            }
        });
    });
}

/**
 * Reorder steps by dragging their ⋮⋮ handle (or with ↑/↓ on a focused handle).
 * Pointer events with capture, and the card moves in the list as you go, so
 * there is no floating copy to lose and no native drag to fight with.
 */
function enableSimpleDragAndDrop(containerSelector, itemSelector) {
    const container = document.querySelector(containerSelector);
    if (!container || container.dataset.dragEnabled) return; // attach once
    container.dataset.dragEnabled = 'true';

    let dragging = null;
    let startOrder = '';
    const order = () => [...container.querySelectorAll(itemSelector)].map((el) => el.dataset.id).join(',');

    const finish = () => {
        if (!dragging) return;
        const card = dragging;
        card.classList.remove('dragging');
        container.classList.remove('is-reordering');
        dragging = null;
        if (order() !== startOrder) {
            updateStepNumbers(container);
            // The pointerup also arrives as a click on the card; do not open the editor for it.
            card.dataset.justDragged = '1';
            setTimeout(() => { delete card.dataset.justDragged; }, 0);
        }
    };

    container.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || e.button !== 0) return;
        const card = handle.closest(itemSelector);
        if (!card) return;
        e.preventDefault();
        handle.setPointerCapture?.(e.pointerId);
        dragging = card;
        startOrder = order();
        card.classList.add('dragging');
        container.classList.add('is-reordering');
    });

    container.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // Put the card before the first other card whose middle is below the pointer.
        const others = [...container.querySelectorAll(`${itemSelector}:not(.dragging)`)];
        const before = others.find((el) => {
            const box = el.getBoundingClientRect();
            return e.clientY < box.top + box.height / 2;
        });
        if (before) {
            if (dragging.nextElementSibling !== before) container.insertBefore(dragging, before);
        } else if (others.length) {
            const last = others[others.length - 1];
            if (last.nextElementSibling !== dragging) last.after(dragging);
        }
    });

    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);

    // Keyboard: ↑/↓ on a focused handle moves that step one place.
    container.addEventListener('keydown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const card = handle.closest(itemSelector);
        const sibling = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
        if (!sibling || !sibling.matches(itemSelector)) return;
        e.preventDefault();
        if (e.key === 'ArrowUp') sibling.before(card); else sibling.after(card);
        updateStepNumbers(container);
        handle.focus();
    });
}

function updateStepNumbers(container) {
    const cards = container.querySelectorAll('.tour-card');
    const updatedOrder = [];

    cards.forEach((card, index) => {
        const newStep = index + 1;
        const id = card.dataset.id;

        // Update the step number in the header display
        const header = card.querySelector('.tour-card-header h2');
        if (header) {
            header.textContent = `Step ${newStep}`;
        }

        updatedOrder.push({
            id,
            step_number: newStep
        });

        if(newTour){
            const stepIndex = newSteps.findIndex(step => String(step.id) === String(id));
            if (stepIndex !== -1) {
                newSteps[stepIndex].step_number = newStep;
            }
        }
    });

    if (newTour) {
        newSteps.sort((a, b) => a.step_number - b.step_number);
    }

    // Send new order to backend
    vscode.postMessage({ command: 'reorderTourSteps', steps: updatedOrder, willSave: !newTour});
    numberOfEditedSteps += 1;
}

document.addEventListener('DOMContentLoaded', () => {
    injectConfirmModal();
    window.addEventListener('message', (event) => {
        const message = event.data;

        if (event.data.command === "transcription") {
            const text = event.data.text || '';
            // Prefer the textarea inside the current edit container, otherwise use the first visible step-textarea
            let targetTextarea = null;
            try {
                if (typeof currentEditContainer === 'object' && currentEditContainer) {
                    targetTextarea = currentEditContainer.querySelector && currentEditContainer.querySelector('.step-textarea');
                }
            } catch (e) {
            console.error('Unexpected error:', e);
        }
            if (!targetTextarea) targetTextarea = document.querySelector('.step-textarea');
            if (targetTextarea) {
                targetTextarea.value = text;
                // keep editableStep in sync if present
                try { editableStep.content = text; } catch (e) { /* ignore */ }
            }
         }

        if(message.command === 'addQuiz'){
            // The quiz editor names the tour itself; nothing else to show here.
            document.getElementById('tour-steps-list-container').innerHTML = '';
            // A hand-written tour is complete without a quiz, so it can be skipped.
            loadQuizAndOpenEditor(message.tourName, message.tourId, { skippable: true });
        }

        if(message.command === 'tourDescriptionReady'){
            const container = document.querySelector('.step-textarea');
            if (container) container.value = message.step;
            editableStep.content= message.step;
        }   

        if (message.command === 'updateEditTourStepList') {
            startTime = new Date().toISOString();
            numberOfEditedSteps = 0;
            const tourName= message.tourName;
            const tourId= message.tourId;
            newTour=false;
            const container = document.getElementById('tour-steps-list-container');
            container.innerHTML = `
                <div class="editTourContainer">
                    <div class="tour-header-bar">
                        <button id="back-button" class="back-button" title="Go back">&#8592;</button>
                        <div class="editable-title-wrapper">
                            <h1 contenteditable="true" class="title-tour" spellcheck="false">${message.tourName}</h1>
                        </div>
                        <button class="add-step-button" title="Add new step">+ Add step</button>
                        <p class="tour-edit-hint">Click the title to rename. Drag ⋮⋮ to reorder; click a step to edit it.</p>
                    </div>
                </div>
            `;
            const wrapper = document.querySelector('.editable-title-wrapper');
            const titleElement = document.querySelector('.title-tour');
            let updatedTourName = titleElement.innerText.trim();
            const originalTourName = updatedTourName;

            titleElement.addEventListener('focus', () => {
                // Fires when user clicks on the title
                wrapper.style.borderColor = 'rgba(255, 255, 255, 1)';
                titleElement.style.fontSize = '22px';
            });
    
            titleElement.addEventListener('input', () => {
                // Fires on every keystroke
                updatedTourName = titleElement.innerText.trim();
            });

            const backButton= document.querySelector('.back-button');
            backButton.addEventListener("click", (e)=>{
                e.preventDefault();
                e.stopPropagation();

                //Store the number of edit actions made in this session
                
                function postMessageWithCallback(callback) {
                    vscode.postMessage({
                        command: 'storeEditHistory',
                        tourId: tourId,
                        numberOfEditedSteps: numberOfEditedSteps,
                        startTime: startTime,
                        endTime: new Date().toISOString(),
                        actionType: 'editTour'
                    });
                    // Simulate callback after some time or after response
                    callback();  // this would be called once the message is processed
                }

                if (numberOfEditedSteps > 0) {
                    postMessageWithCallback(() => {
                        const myTours = document.getElementById("my-tours-tab");
                        myTours.click();
                    });
                } else {
                    const myTours = document.getElementById("my-tours-tab");
                    myTours.click();
                }
                
            });

            titleElement.addEventListener('blur', () => {
                // Fires when user finishes editing and clicks elsewhere
                // User clicked elsewhere: fade border + post update
                wrapper.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                titleElement.style.fontSize = '26px';

                if (updatedTourName && updatedTourName !== originalTourName) {
                    vscode.postMessage({
                        command: 'updateTourTitle',
                        newTitle: updatedTourName
                    });
                    numberOfEditedSteps += 1;
                };
            });
                
            const steps= fetchTourSteps(tourName)
                .then((steps) => {
                    renderTourSteps(steps);
                })
                .catch((err) => {
                });

            loadQuizAndOpenEditor(tourName, tourId);

            const addButton = container.querySelector('.add-step-button');
            addButton?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({command: 'sendProjectFiles'});
                const listContainer = document.getElementById('tour-steps-list-container');
                const stepCount = listContainer ? listContainer.childElementCount : 1;
                newStepModal(stepCount); // Show modal with step number
                currentEditContainer = document.getElementById('new-step-modal');
                numberOfEditedSteps += 1;
            });

            enableSimpleDragAndDrop('#tour-steps-list-container', '.tour-card');
            const innerScrollable = document.getElementById('tour-steps-list-container');

            innerScrollable.addEventListener('wheel', function (e) {
            const delta = e.deltaY;
            const up = delta < 0;
            const scrollTop = innerScrollable.scrollTop;
            const scrollHeight = innerScrollable.scrollHeight;
            const offsetHeight = innerScrollable.offsetHeight;

            const atTop = scrollTop === 0;
            const atBottom = scrollTop + offsetHeight >= scrollHeight;

            if ((up && atTop) || (!up && atBottom)) {
                // Let the outer container handle the scroll
                return;
            }

            // Prevent scroll from bubbling up
            e.stopPropagation();
            }, { passive: false });
        }

        if (message.command === 'updateSelection') {
            const { startLine, endLine } = event.data;
            if (currentEditContainer || editableStep.filePath) {
                document.querySelector('.start-line-input').value = startLine;
                document.querySelector('.end-line-input').value = endLine;
                editableStep.startLine = startLine;
                editableStep.endLine = endLine;
            }
        }

        if (message.command === 'createManualTour') {
            startTime = new Date().toISOString();
            numberOfEditedSteps = 0;
            // Clear previous steps to avoid showing old steps in new manual tour
            newSteps = [];
            const container = document.getElementById('tour-steps-list-container');
            container.innerHTML = `
            <div class="newTourContainer tour-form-card">
                <div class="tour-header-bar">
                    <h1 class="tour-title">New guided tour</h1>
                    <p class="tour-form-method"><strong>Manual</strong> · Write each step yourself.</p>

                    <div class="form-section">
                        <h2 class="section-heading">Tour Setup</h2>
                        <label for="tour-name2" class="form-subtitle">Tour Name</label>
                        <input type="text" id="tour-name2" class="form-input" placeholder="Enter a tour title" required>
                        <div class="error-message" id="name-error" style="display: none;"></div>
                    </div>

                    <div class="form-section">
                        <h2 class="section-heading">Audience</h2>
                        <label class="form-subtitle">Target Department</label>
                        <div class="pill-radio-group2" id="target-department2">
                            <!-- filled from the server by renderDepartmentOptions -->
                        </div>
                        <div class="error-message" id="department-error" style="display: none;"></div>
                    </div>

                    <div class="form-section">
                        <div class="new-step-header">
                            <h2 class="section-heading">Tour Steps</h2>
                            <button class="add-step-button" title="Add a step">+ Add step</button>
                        </div>
                        <div class="error-message" id="step-error" style="display: none;"></div>
                    </div>
                </div>
            </div>
            `;

            renderDepartmentOptions('target-department2', { name: 'audience', idPrefix: 'audience2' })
                .then(() => {
                    document.querySelectorAll('#target-department2 input[type="radio"]').forEach(radio => {
                        radio.addEventListener('change', () => {
                            const departmentError = document.getElementById('department-error');
                            const departmentContainer = document.getElementById('target-department2');
                            departmentError.textContent = '';
                            departmentError.style.display = 'none';
                            departmentContainer.style.border = 'none';
                            departmentContainer.style.padding = '0';
                        });
                    });
                });

            document.querySelectorAll('#target-department2 input[type="radio"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    const departmentError = document.getElementById('department-error');
                    const departmentContainer = document.getElementById('target-department2');
            
                    departmentError.textContent = '';
                    departmentError.style.display = 'none';
                    departmentContainer.style.border = 'none';
                    departmentContainer.style.padding = '0';
                });
            });

            const tourNameInput = document.getElementById('tour-name2');
            tourNameInput.addEventListener('input', () => {
                tourNameInput.style.border="1px solid #3e3e42";
                const nameError = document.getElementById('name-error');
                nameError.textContent = '';
            });

            newTour = true;
            const addButton = document.querySelector('.add-step-button');
            if (addButton) {
                addButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const stepError = document.getElementById('step-error');
                    stepError.textContent = '';
                    stepError.style.display = 'none';
                    vscode.postMessage({command: 'sendProjectFiles'});
                    numberOfEditedSteps += 1;
                    const listContainer = document.getElementById('tour-steps-list-container');
                    const stepCount = listContainer ? listContainer.childElementCount-1 : 1;
                    newStepModal(stepCount);
                    currentEditContainer = document.getElementById('new-step-modal'); 
                });
            }
            renderTourSteps(newSteps);
            enableSimpleDragAndDrop('#tour-steps-list-container', '.tour-card');

        }

        if(message.command === 'renderTourStepsSuccess') {
            // Close any existing modals
            const newStepModal = document.getElementById('new-step-modal');
            if (newStepModal && !newStepModal.classList.contains('hidden')) {
                newStepModal.classList.add('hidden');
            }

            if(!newTour){
                fetchTourSteps(document.querySelector('.title-tour').textContent.trim())
                .then((steps) => {
                    renderTourSteps(steps);
                    enableAllCards();
                })
                .catch((err) => {
                });
            }
            else{
                renderTourSteps(newSteps);
                enableAllCards();
            }
        }

        if(message.command === 'loadFilesEdit') {
            const projectFiles = message.files;
            const basePath = message.basePath;
            const projectName = message.projectName;

            const container = document.getElementById('file-select-container');
            const fileListContainer= document.createElement('div');
            fileListContainer.id = 'file-explorer-container';
            // The same tree, and the same look, as the AI assisted and exploration forms.
            fileListContainer.className = 'file-explorer';
            container.appendChild(fileListContainer);
            createFileExplorer(projectFiles, 'file-explorer-container');
        }

        if (message.command === 'podcastTourTranscript') {
            // One podcast plays at a time.
            window.lacyPodcastAudio?.pause();

            const SPEAKER = /^(Expert|Junior|Learner):\s*/;
            // Split exactly as the server does when it voices the script, so line i
            // is audio segment i (see server/src/podcast.js).
            const lines = (message.transcript || '')
                .split(/(?=(?:Expert|Junior|Learner):)/g)
                .map((line) => line.trim())
                .filter((line) => SPEAKER.test(line));
            const available = new Set((message.indexes || []).map(Number));

            // Which of the tour's files a line talks about, by name: "board.ts",
            // "board", or "final report" for final_report.py. The longest match wins.
            const tourFiles = [...new Set((message.parsedSteps || []).map((row) => row.file).filter(Boolean))];
            const fileNames = tourFiles.map((file) => {
                const base = file.split(/[\\/]/).pop();
                const stem = base.replace(/\.[^.]+$/, '');
                const spoken = stem.replace(/[_\-.]+/g, ' ').trim();
                return { file, base, names: [...new Set([base, stem, spoken].filter((n) => n.length >= 3))] };
            });
            const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fileFor = (text) => {
                let best = null;
                for (const f of fileNames) {
                    for (const name of f.names) {
                        const re = new RegExp(`(^|[^\\w])${escapeRe(name).replace(/ /g, '[\\s_\\-]+')}(?=$|[^\\w])`, 'i');
                        if (re.test(text) && (!best || name.length > best.len)) best = { f, len: name.length };
                    }
                }
                return best ? best.f : null;
            };
            let shownFile = tourFiles[0] || null;
            const showFile = (file) => {
                if (!file || file === shownFile) return;
                shownFile = file;
                vscode.postMessage({ command: 'podcastFocusFile', file });
            };
            const close = () => vscode.postMessage({ command: 'podcastClosed' });
            const playable = lines.map((_, i) => i).filter((i) => available.has(i));

            const tourStepsContainer = document.getElementById('tour-steps-list-container');
            tourStepsContainer.innerHTML = `
                <div class="tour-header-bar podcast-header">
                    <button type="button" class="back-button" title="Back to the tour list" aria-label="Back">&#8592;</button>
                    <h1 class="title-tour">${escapeHtml(message.tourName || 'Podcast')}</h1>
                </div>
                <p class="lacy-warning" id="podcast-warning" role="alert" hidden></p>
                <p class="podcast-status" id="podcast-status" role="status"></p>
                <div class="podcast-controls" id="transcript-controls">
                    <button type="button" class="tour-cancel-button" id="prev-btn" aria-label="Previous line">⏮</button>
                    <button type="button" class="tour-submit-button" id="pause-btn">Pause</button>
                    <button type="button" class="tour-cancel-button" id="next-btn" aria-label="Next line">⏭</button>
                </div>
                <ol class="podcast-transcript" id="transcript-container"></ol>
            `;

            const status = document.getElementById('podcast-status');
            const pauseBtn = document.getElementById('pause-btn');
            const container = document.getElementById('transcript-container');

            const bubbles = lines.map((raw, i) => {
                const li = document.createElement('li');
                const speaker = raw.match(SPEAKER)[1];
                li.className = `podcast-line ${speaker === 'Expert' ? 'is-expert' : 'is-junior'}${available.has(i) ? '' : ' is-missing'}`;
                const isExpert = speaker === 'Expert';
                const avatar = document.createElement('span');
                avatar.className = 'podcast-avatar';
                avatar.setAttribute('aria-hidden', 'true');
                if (isExpert) {
                    const img = document.createElement('img');
                    img.src = window.lacyLogoUri;
                    img.alt = '';
                    avatar.appendChild(img);
                } else {
                    avatar.textContent = 'L';
                }
                const bubble = document.createElement('div');
                bubble.className = 'podcast-bubble';
                const who = document.createElement('span');
                who.className = 'podcast-speaker';
                who.textContent = isExpert ? 'Expert' : 'Learner';
                const text = document.createElement('p');
                text.className = 'podcast-text';
                text.textContent = raw.replace(SPEAKER, '');
                bubble.append(who, text);
                const mentioned = fileFor(text.textContent);
                li.dataset.file = mentioned ? mentioned.file : '';
                if (mentioned) {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'podcast-file';
                    chip.textContent = mentioned.base;
                    chip.title = `Show ${mentioned.file}`;
                    chip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        shownFile = null;
                        showFile(mentioned.file);
                    });
                    bubble.appendChild(chip);
                }
                li.append(avatar, bubble);
                if (available.has(i)) {
                    li.tabIndex = 0;
                    li.title = 'Play from here';
                    li.addEventListener('click', () => playFrom(playable.indexOf(i)));
                    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') playFrom(playable.indexOf(i)); });
                }
                container.appendChild(li);
                return li;
            });

            const audio = new Audio();
            window.lacyPodcastAudio = audio;
            let pos = 0;          // position in `playable`
            let token = 0;        // ignores clips that arrive after the user moved on

            const setStatus = (text) => { status.textContent = text; };
            const warningBox = document.getElementById('podcast-warning');
            const warn = (text) => { warningBox.textContent = text; warningBox.hidden = false; };
            const unplayable = new Set();
            const highlight = (line) => {
                bubbles.forEach((el, i) => el.classList.toggle('is-current', i === line));
                bubbles[line]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };

            function finish() {
                highlight(-1);
                pauseBtn.textContent = 'Play again';
                setStatus('End of the podcast.');
            }

            function playFrom(p) {
                if (p < 0) p = 0;
                if (p >= playable.length) { finish(); return; }
                pos = p;
                const line = playable[p];
                const mine = ++token;
                highlight(line);
                showFile(bubbles[line]?.dataset.file);
                pauseBtn.textContent = 'Pause';
                setStatus(`Line ${p + 1} of ${playable.length}`);
                // fetch() carries the session token; a media element's own request does not.
                fetch(`${window.LACY_API_URL}/api/tours/${message.tourId}/audio-segments/${line}/blob`)
                    .then((response) => {
                        if (!response.ok) throw new Error(`Server returned ${response.status}`);
                        return response.blob();
                    })
                    .then((blob) => {
                        if (mine !== token) return;
                        if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
                        audio.src = URL.createObjectURL(blob);
                        return audio.play();
                    })
                    .catch((err) => {
                        if (mine !== token) return;
                        console.warn('Podcast line could not play:', err);
                        // Say so, rather than skipping in silence.
                        unplayable.add(line);
                        bubbles[line]?.classList.add('is-missing');
                        warn(unplayable.size === playable.length
                            ? 'None of this podcast\'s audio could be played. The server may be unreachable, or the audio files are missing. You can still read the conversation.'
                            : `${unplayable.size} line${unplayable.size === 1 ? '' : 's'} could not be played and ${unplayable.size === 1 ? 'was' : 'were'} skipped.`);
                        playFrom(p + 1);
                    });
            }

            audio.onended = () => playFrom(pos + 1);

            pauseBtn.addEventListener('click', () => {
                if (!playable.length) return;
                if (pauseBtn.textContent === 'Play again') { playFrom(0); return; }
                if (audio.paused) {
                    audio.play().catch(() => playFrom(pos));
                    pauseBtn.textContent = 'Pause';
                } else {
                    audio.pause();
                    pauseBtn.textContent = 'Play';
                }
            });
            document.getElementById('next-btn').addEventListener('click', () => playFrom(pos + 1));
            document.getElementById('prev-btn').addEventListener('click', () => playFrom(pos - 1));
            tourStepsContainer.querySelector('.back-button').addEventListener('click', (e) => {
                e.preventDefault();
                token++;
                audio.pause();
                close();
                document.getElementById(message.isGuided ? 'my-tours-tab' : 'tours-tab')?.click();
            });

            // Leaving through a tab stops it as well.
            document.querySelectorAll('#app-tabs .tab').forEach((tab) => tab.addEventListener('click', () => {
                token++;
                audio.pause();
                close();
            }, { once: true }));

            if (!playable.length) {
                document.getElementById('transcript-controls').hidden = true;
                if (lines.length) {
                    warn('There is no audio for this podcast, so it cannot be listened to. Its audio was never made: '
                        + 'the server has no ElevenLabs key (ELEVENLABS_API_KEY), or the key was rejected. You can still read the conversation below.');
                } else {
                    warn('This tour has no podcast.');
                }
                return;
            }
            if (playable.length < lines.length) {
                warn(`${lines.length - playable.length} of ${lines.length} lines have no audio and will be skipped.`);
            }
            playFrom(0);
        }   
    });
});