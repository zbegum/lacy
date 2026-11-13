/**
 * Leave the finished tour for a tab. Finishing a tour is not abandoning a form,
 * so the "unsaved changes" check (which would otherwise wait for an answer over
 * an empty page) is cleared first; and if the tab did not take over, its page is
 * shown directly, so the panel is never left blank.
 */
function returnToTab(tabId) {
    if (typeof formIsDirty !== 'undefined') formIsDirty = false;
    document.getElementById(tabId)?.click();
    setTimeout(() => {
        if (document.querySelector('.content.active')) return;
        const page = tabId === 'tours-tab' ? 'tours-content' : 'my-tours-content';
        document.getElementById(page)?.classList.add('active');
        document.getElementById(tabId)?.classList.add('active');
    }, 50);
}

// Add the event listener for messages
document.addEventListener('DOMContentLoaded', async () => {

    const feedbackContainer = document.getElementById('feedback-container');

    async function fetchFeedback(userId, tourId) {
        try {
            const response = await fetch(`${window.LACY_API_URL}/api/get-feedback?user_id=${userId}&tour_id=${tourId}`);
            const feedback = await response.json();           
            if (feedback.feedbackExists === false) {
                return null;
            }
            else {
            return feedback;
            }
        } catch (error) {
            return null;
        }
    }
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

    window.addEventListener('message', async (event) => {
        const message = event.data;

        if (message.command === 'renderFeedbackPage') {
            let tourName = message.tourName;
            const feedbackContainer = document.getElementById('feedback-container');
            const loadingFeedback = document.getElementById('loading-feedback');
            if(tourName == undefined){
                tourName = localStorage.getItem('selectedTourName');
            }
            feedbackContainer.style.display = 'none'; 
            loadingFeedback.style.display = 'flex'; // Show loading screen
            try {
                // Fetch the tour ID
                const response = await getTourId(tourName);
                const { tour_id: tourID, isGuided, user_id: creatorId } = response;
                
                // Fetch feedback from the database
                if(!isGuided){
                    // An exploration has no feedback step: back to the list, refreshed
                    // so the one just finished shows as completed.
                    loadingFeedback.style.display = 'none';
                    returnToTab('tours-tab');
                    window.postMessage({ command: 'refreshExplorations' }, '*');
                    return;
                }
                const user = JSON.parse(localStorage.getItem('user'));

                if (!user || !tourID) {
                    throw new Error('Missing user or tour ID.');
                }
                loadingFeedback.style.display = 'flex';
                if (user.id == creatorId) {
                    loadingFeedback.style.display = 'none';
                    returnToTab('my-tours-tab');
                    return;
                }
                const feedback = await fetchFeedback(user.id, tourID);
                // Render the appropriate screen based on the feedback response
                if (!feedback || !feedback.feedback || Object.keys(feedback.feedback).length === 0) {
                    renderFeedbackForm(tourID);
                } else {
                    renderExistingFeedback(feedback); // Render the feedback if it exists
                }
            
            } catch (error) {

                // Hide the loading screen and show an error message
                if (loadingFeedback) {
                    loadingFeedback.style.display = 'none';
                }
                if (feedbackContainer) {
                    feedbackContainer.innerHTML = `
                        <p style="color: red;">An error occurred while loading feedback. Please try again later.</p>
                    `;
                    feedbackContainer.style.display = 'block'; // Show the error message
                }
            }
        }
    });
});

// Attach feedback listeners
function attachFeedbackListeners(tourID) {
    const stars = document.querySelectorAll('.star');
    let selectedRating = 0;

    stars.forEach(star => {
        star.addEventListener('click', function () {
            const selectedRating = parseInt(this.dataset.value, 10);

            // Reset all stars
            stars.forEach(s => {
                s.innerHTML = '&#9734;'; // Empty star
                s.classList.remove('selected'); // Remove the selected class
            });

            // Highlight stars up to the selected rating
            for (let i = 0; i < selectedRating; i++) {
                stars[i].innerHTML = '&#9733;'; // Filled star
                stars[i].classList.add('selected'); // Add the selected class
            }

        });
    });

    document.getElementById('submit-feedback').addEventListener('click', async () => {
        const feedbackText = document.getElementById('feedback-text').value.trim() || ""; // Default to empty string if null
        const rating = document.querySelectorAll('.star.selected').length; // Count the selected stars
        const ratingError = document.getElementById('rating-error');
        const ratingStars = document.getElementById('rating-stars');

        // Validation: Ensure a rating is selected
        if (rating === 0) {
            // Show the error message
            ratingError.style.display = 'block';
            ratingError.textContent = 'Please select a rating before submitting your feedback.';
            // Add a red border to the stars container
            ratingStars.style.border = '2px solid red';
            return; // Stop the submission process
        } else {
            // Hide the error message and remove the red border if rating is valid
            ratingError.style.display = 'none';
            ratingStars.style.border = 'none';
        }

            // Retrieve the start time from localStorage
        const tourStartTime = localStorage.getItem('tourStartTime');
        if (!tourStartTime) {
            return;
        }

        // Calculate the duration in seconds
        const timeSpent = Math.floor((Date.now() - parseInt(tourStartTime, 10)) / 1000);

        const user = JSON.parse(localStorage.getItem('user'));
        if (!user) {
            window.location.href = '/login.html'; // Redirect to login page if user is not logged in
            return;
        }

        const feedbackData = {
            tour_id: tourID,
            user_id: user.id,
            tour_status: 'completed',
            feedback: feedbackText, // Feedback is always a string (empty if null)
            rating: rating,
            time_spent: timeSpent // Replace with the actual time spent in seconds
        };

        const submitButton = document.getElementById('submit-feedback');
        if (submitButton) submitButton.disabled = true;

        try {
            const response = await fetch(`${window.LACY_API_URL}/api/submit-feedback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(feedbackData)
            });

            const result = await response.json();
            if (response.ok) {
                localStorage.removeItem('tourStartTime');
                const lastType = localStorage.getItem('lastTourType');

                if (lastType === 'exploration') {
                    document.getElementById('tours-tab')?.click();
                } else {
                    document.getElementById('my-tours-tab')?.click();
                }
                localStorage.removeItem('lastTourType');
            } else {
                vscode.postMessage({
                    command: 'showError',
                    text: `Could not submit your feedback: ${result?.error || response.status}. Please try again.`
                });
            }
        } catch (error) {
            vscode.postMessage({
                command: 'showError',
                text: 'Could not submit your feedback. Please check that the Lacy server is running and try again.'
            });
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });

}

function renderExistingFeedback(feedback) {
    const feedbackContainer = document.getElementById('feedback-container');

    if (!feedbackContainer) {
        return;
    }
    document.getElementById('loading-feedback').style.display = 'none';

    feedbackContainer.innerHTML = `
        <h2>Your Feedback</h2>
        <p>Thank you for providing feedback for this tour. Below is your submitted feedback:</p>
        
        <div class="feedback-section">
            <label>Your Feedback:</label>
            <p>${feedback.feedback.feedback || 'No feedback provided.'}</p>
        </div>
        
        <div class="rating-section">
            <label>Your Rating:</label>
            <p>${'★'.repeat(feedback.feedback.rating ?? 0)}${'☆'.repeat(Math.max(0, 5 - (feedback.feedback.rating ?? 0)))}</p>
        </div>
        
        <div class="time-spent-section">
            <label>Time Spent:</label>
            <p>${feedback.feedback.time_spent} seconds</p>
        </div>
        
        <button id="return-to-tours" class="return-button">Return to Tours Tab</button>
    `;

    const returnButton = document.getElementById('return-to-tours');
    if (returnButton) {
        returnButton.addEventListener('click', () => {
            feedbackContainer.style.display = 'none'; // Hide the feedback container
            const lastType = localStorage.getItem('lastTourType');

            if (lastType === 'exploration') {
                document.getElementById('tours-tab')?.click();
            } else {
                document.getElementById('my-tours-tab')?.click();
            }
            localStorage.removeItem('lastTourType');;
        });
    }
}

function renderFeedbackForm(tourID) {
    const feedbackContainer = document.getElementById('feedback-container');
    if (!feedbackContainer) {
        return;
    }
    document.getElementById('loading-feedback').style.display = 'none';

    feedbackContainer.innerHTML = `
        <h2>We Value Your Feedback</h2>
                <div class="feedback-section">
            <label for="feedback-text">Share anything that could make the tour better:</label>
            <textarea id="feedback-text" rows="4" placeholder="Were any important details missing? Was the flow easy to follow? How clear and efficient were the explanations?" style="width: 100%;"></textarea>
        </div>
        <div class="rating-section">
            <label for="rating-stars">Rate your experience:</label>
            <div id="rating-stars" class="rating-stars">
                ${[1, 2, 3, 4, 5].map(star => `
                    <span class="star" data-value="${star}" style="font-size: 24px; cursor: pointer;">&#9734;</span>
                `).join('')}
            </div>
            <p id="rating-error" style="color: red; display: none; margin-top: 5px;">Please select a rating before submitting your feedback.</p>
        </div>
    
    <div class="feedback-actions">
        <button id="return-to-tours" class="skip-button">Skip</button>
        <button id="submit-feedback" class="fb-button">Submit Feedback</button>
    </div>
    `;

    attachFeedbackListeners(tourID); // Attach event listeners for the feedback form

    const returnButton = document.getElementById('return-to-tours');
    if (returnButton) {
        returnButton.addEventListener('click', () => {
            feedbackContainer.style.display = 'none'; 
            const lastType = localStorage.getItem('lastTourType');

            if (lastType === 'exploration') {
                document.getElementById('tours-tab')?.click();
            } else {
                document.getElementById('my-tours-tab')?.click();
            }
            localStorage.removeItem('lastTourType');
        });
    }
}