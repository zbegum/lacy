document.addEventListener('DOMContentLoaded', () => {

    const loginContainer= document.getElementById("login-container");
    const toursTab= document.getElementById('tours-tab');
    const appTabs = document.getElementById("app-tabs");

    // Wait for session restoration
    setTimeout(() => {
        const state = vscode.getState();
        const userSession = state?.userSession;
        const user = state?.user;

        if (userSession && user) {
            localStorage.setItem('user', JSON.stringify(user)); // Store user in local storage
            // Hide the login form
            loginContainer.style.display = 'none';
        } else {

            const logoSrc = window.lacyLogoUri;

            loginContainer.innerHTML = `
              <div class="landing-wrapper">
                <img src="${logoSrc}" class="landing-logo" alt="Lacy the Ghost Mascot" />
                <div class="landing-brand">LACY</div>
                <p class="landing-subtitle">Explore with Lacy — your codebase guide.</p>
            
                <div class="login-wrapper">
                    <form id="login-form">
                        <label for="server-url">Lacy server</label>
                        <input type="text" id="server-url" placeholder="http://lacy.your-team.com:4000" required>
                        <label for="email">Email</label>
                        <input type="email" id="email" placeholder="Enter your email" required>
                        <label for="password">Password</label>
                        <input type="password" id="password" placeholder="Enter your password" required>
                        <button class="login-button" type="submit">Login</button>
                    </form>
                    <div class="login-help">
                        <p><strong>Where do I get these?</strong> From whoever runs Lacy for your
                        team: they give you the server address, your email and a password.
                        There is no sign-up here.</p>
                        <p>Setting Lacy up for your team?
                        <a href="#" id="setup-guide-link">Read the setup guide</a>. One command
                        starts a server, one more creates each account.</p>
                    </div>
                </div>
              </div>
            `;

            const serverInput = document.getElementById('server-url');
            serverInput.value = window.LACY_API_URL || 'http://localhost:4000';

            document.getElementById('setup-guide-link').addEventListener('click', (e) => {
                e.preventDefault();
                vscode.postMessage({ command: 'openSetupGuide' });
            });

            const form = document.getElementById('login-form');
            form.addEventListener('submit', (e) => {
                e.preventDefault(); // Prevent the form from refreshing the page

                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const server = serverInput.value.trim().replace(/\/+$/, '');

                fetchUser(email, password, server);
            });
        }
    }, 100); // Wait 100ms for session restoration

    async function fetchUser(mail, pass, server) {

        const loginData = {
            email: mail,
            password: pass
        };

        const apiBase = server || window.LACY_API_URL;

        // Check the address before blaming the credentials: a wrong server and a
        // wrong password should not look the same.
        try {
            const health = await fetch(`${apiBase}/api/health`);
            if (!health.ok) throw new Error(`the server answered ${health.status}`);
        } catch (err) {
            showLoginError(`Cannot reach a Lacy server at ${apiBase}. Check the address, and that the server is running.`);
            return;
        }

        try {
            // Make a POST request to the server to fetch user by email and password
            const response = await fetch(`${apiBase}/api/get-user-by-email-and-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(loginData)  // Send email and password in the request body
            });
    
            if (response.ok) {
                const { token, ...user } = await response.json();
                localStorage.setItem('user', JSON.stringify(user)); // Stored user in local storage
                localStorage.setItem('lacyToken', token); // Sent as a Bearer token on API calls

                //Send session to VS Code extension for session continuation
                vscode.postMessage({
                    command: 'login',
                    serverUrl: apiBase,
                    userSession: user,
                    token,
                    user: {
                        email: user.email,
                        role: user.role,
                        id: user.id
                    }
                });
                
                // Handle the successful login, e.g., redirect the user
                toursTab?.click();

            } else {
                showLoginError('Email or password is wrong');
            }
        } catch (error) {
            console.error('Unexpected error:', error);
            showLoginError('Could not sign in. Please try again.');
        }
    }

    function showLoginError(text) {
        document.querySelectorAll('.wrong-popup').forEach((el) => el.remove());

        const popup = document.createElement('span');
        popup.className = 'wrong-popup';
        popup.textContent = text;

        // Centred above the form.
        popup.style.position = 'absolute';
        popup.style.top = '20px';
        popup.style.left = '50%';
        popup.style.transform = 'translateX(-50%)';
        popup.style.maxWidth = '90%';
        popup.style.textAlign = 'center';

        popup.style.backgroundColor = 'var(--lacy-danger)';
        popup.style.color = 'var(--lacy-on-accent)';
        popup.style.padding = 'var(--lacy-space-2) var(--lacy-space-4)';
        popup.style.borderRadius = 'var(--lacy-radius)';
        popup.style.fontSize = 'var(--lacy-text-sm)';
        popup.style.fontWeight = '500';
        popup.style.zIndex = '1000';
        popup.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 5000);
    }

});

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.command === 'restoreSession') {
        const userSession = message.userSession;

        const state = vscode.getState() || {};
        state.userSession = userSession;
        vscode.setState(state);

        if (userSession) {
            document.getElementById('login-container').style.display = 'none';
        }
    }

    if (message.command === 'restoreUser') {
        const user = message.user;

        const state = vscode.getState() || {};
        state.user = user;
        vscode.setState(state);

        if (user) {
            document.getElementById('login-container').style.display = 'none';
        }
    }
});