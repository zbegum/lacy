// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { getHtmlForWebview } from './sidebar-panel/htmlProvider';
import { serverUrl } from './config';
import { resolveProjectKey } from './projectKey';
import { anchorTextFor, locateStep, anchorWarning } from './anchors';
import * as fs from 'fs';

/** Where the sign-in form sends people who need to set up a server or accounts. */
const SETUP_GUIDE_URL = 'https://github.com/zbegum/lacy/blob/main/INSTALL.md';

/** Session token for the Lacy API, kept in sync with the extension's stored session. */
let authToken: string | undefined;

/** When the "can't reach the server" warning was last shown, so it is not repeated per request. */
let lastOfflineNotice = 0;

/** Call the Lacy API with the session token attached. */
async function apiFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
    }
    let response: Response;
    try {
        response = await fetch(`${serverUrl()}${apiPath}`, { ...init, headers });
    } catch (err) {
        // Not an HTTP error: nothing answered. Say so once, not once per request.
        if (Date.now() - lastOfflineNotice > 30_000) {
            lastOfflineNotice = Date.now();
            vscode.window.showWarningMessage(
                `Can't reach the Lacy server at ${serverUrl()}. Check that it is running; the panel reconnects by itself when it is back.`,
            );
        }
        throw err;
    }
    if (response.status === 401) {
        vscode.window.showWarningMessage('Your Lacy session has expired. Please sign in again.');
    }
    return response;
}

/** Send audio to the server for transcription (the server owns the speech-to-text keys). */
async function transcribeAudio(audioBase64: string, mimeType = 'audio/wav'):
    Promise<{ success: boolean; transcript: string; error?: string }> {
    const response = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, mimeType }),
    });
    const result = await response.json() as { success?: boolean; transcript?: string; error?: string };
    if (!response.ok || !result.success) {
        return { success: false, transcript: '', error: result.error || `Server returned ${response.status}` };
    }
    return { success: true, transcript: result.transcript || '' };
}
interface TourStep {
    id: number;
    anchor_text?: string | null;
    tour_id: number;
    step_number: number;
    description: string;
    file_path: string;
    line_start: number;
    line_end: number;
    created_at: Date;
    question?: string | null;
    answer?: string | null;
    isGuided?: number;
}
interface QuizQuestion {
    question_id: number;
    tour_id: number;
    score: number;
    question: string;
    options: string[];//bcs they are json objects
    answers: string[];
    question_type: string;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let currentDecorationType: vscode.TextEditorDecorationType | undefined;

/**
 * Every highlight Lacy puts on code, so all of them can be taken off again.
 * A decoration only disappears when its own type is disposed; applying a new,
 * empty type (what the old clear did) leaves the old ones in place.
 */
const lacyHighlights = new Set<vscode.TextEditorDecorationType>();

function lacyHighlight(): vscode.TextEditorDecorationType {
    const type = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(78, 0, 102, 1)' });
    lacyHighlights.add(type);
    return type;
}

function clearAllLacyHighlights() {
    lacyHighlights.forEach((type) => type.dispose());
    lacyHighlights.clear();
    currentDecorationType = undefined;
}
let lineSelectionPossible: boolean = false; // Track if line selection is possible
let tourStartTime: string = "";
let tourId: number = 0;

export function activate(context: vscode.ExtensionContext) {

    // Retrieve stored session
    authToken = context.globalState.get<string>('lacyToken');
    const session = context.globalState.get("userSession");

    const user = context.globalState.get("user");

    context.subscriptions.push(
        vscode.commands.registerCommand('lacy.setServerUrl', async () => {
            const entered = await vscode.window.showInputBox({
                title: 'Lacy server',
                prompt: 'Address of the Lacy server your team runs',
                value: serverUrl(),
                placeHolder: 'http://lacy.your-team.com:4000',
                validateInput: (value) => (/^https?:\/\/.+/.test(value.trim()) ? undefined : 'Enter a URL, e.g. http://localhost:4000'),
            });
            if (!entered) return;

            await vscode.workspace.getConfiguration('lacy')
                .update('serverUrl', entered.trim().replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Lacy will use ${entered.trim()}. Sign in again if you were signed in.`);
        }),
    );

    // Register the webview view provider correctly
    const provider = new MyViewProvider(context, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('myViewId', provider)
    );

    const workspaceFolders = vscode.workspace.workspaceFolders;
    let projectName = 'Unknown Project';
    let projectPath = '';
    if (workspaceFolders && workspaceFolders.length > 0) {
        projectName = workspaceFolders[0].name;
        projectPath = workspaceFolders[0].uri.fsPath;
    }

    // Extract the part of the path up until the project name
    const basePath = projectPath.substring(0, projectPath.lastIndexOf(projectName));

   vscode.workspace.findFiles('**/*', '**/node_modules/**').then(files => {
        const filePaths = files.map(file => file.fsPath);
        
            // Send files to the webview using the public method
            provider.sendFilesToWebview(filePaths);
    });

}

function updateSelection(startLine: number, endLine: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if(lineSelectionPossible == false) return;

    const range = new vscode.Range(startLine - 1, 0, endLine - 1, 0);
    const highlightDecoration = lacyHighlight();

    editor.setDecorations(highlightDecoration, [range]);

    if (currentDecorationType) {
        currentDecorationType.dispose();
    }

    currentDecorationType = highlightDecoration;
    
}

// Store session in globalState
async function storeSession(context: vscode.ExtensionContext, sessionData: any) {
    await context.globalState.update("userSession", sessionData);
}

class MyViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _parsedRows: any[] = [];
    private _currentStepIndex: number = 0;
    private _basePath: string = '';
    private _projectName: string = '';
    /** Git-remote-based project id; folder name when the project is not in git. */
    private _projectKey: string = '';
    private _startedTourName: string = ""; // Store the name of the started tour
    private _lineSelectionPossible: boolean = false; // Track if line selection is possible
    private _user_id: Number = 0;
    private filePaths: any[] = [];
    private _isGuided: number = 1;
    private _recorder: any = null;
    private recordingSelectedFiles: string[] = [];
    private _pendingStepIndex: number | null = null; // holds step number awaiting transcription

    private recordingActive = false;
    private _recordingFilePath: any;
    
    constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _extensionUri: vscode.Uri
    ) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let projectName = 'Unknown Project';
        let projectPath = '';
        if (workspaceFolders && workspaceFolders.length > 0) {
            projectName = workspaceFolders[0].name;
            projectPath = workspaceFolders[0].uri.fsPath;
        }

        this._basePath = projectPath.substring(0, projectPath.lastIndexOf(projectName));
        this._projectName = projectName;
        this._projectKey = projectName.trim().toLowerCase();

        if (projectPath) {
            // Tours are grouped by git remote so they survive being cloned into a
            // differently named folder.
            resolveProjectKey(projectPath, projectName)
                .then((key) => { this._projectKey = key; })
                .catch((err) => console.error('Could not resolve the project key:', err));
        }
    }
    
    resolveWebviewView(view: vscode.WebviewView) {
        this._view = view;
        
        const user = this._context.globalState.get('user');
        const userSession = this._context.globalState.get('userSession');

        view.webview.postMessage({
            command: 'restoreSession',
            userSession: userSession
        });
    
        view.webview.postMessage({
            command: 'restoreUser',
            user: user
        });

        view.webview.options = {
            enableScripts: true,
            //these need to be updated if any other directory is added
            localResourceRoots: [
                // One root for the whole panel: adding a file no longer means
                // remembering to list its directory here.
                vscode.Uri.joinPath(this._extensionUri, 'src', 'sidebar-panel'),
                vscode.Uri.joinPath(this._extensionUri, 'resources'),
            ],
        };

        vscode.window.onDidChangeTextEditorSelection((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !lineSelectionPossible) return;
            
            const selection = editor.selection;
            const startLine = selection.start.line + 1; // Convert to 1-based index
            const endLine = selection.end.line + 1;
    
            updateSelection(startLine, endLine);
            // Ensure the WebView is open before sending the message
            this._view?.webview.postMessage({
                command: 'updateSelection',
                startLine,
                endLine
            });
    });

        (view as any).retainContextWhenHidden = true; //When tab is closed continue the session

        view.webview.html = getHtmlForWebview(this._extensionUri, view.webview);

       // Restore session if available
        const session = this.getSession();

        if (session) {
            view.webview.postMessage({ command: 'restoreSession', userSession: session });
        }

        if (user) { 
            view.webview.postMessage({ command: 'restoreUser', user: user });
        }

        let previousDecorationType: vscode.TextEditorDecorationType | undefined;
        
        view.webview.onDidReceiveMessage(async (data) => {
            const user = this.getUser();
            switch (data.command) {
                case 'requestSession':
                    const session = this.getSession();
                    view.webview.postMessage({ command: 'restoreSession', userSession: session });
                    break;
                case 'openSetupGuide':
                    vscode.env.openExternal(vscode.Uri.parse(SETUP_GUIDE_URL));
                    break;
                case 'requestUser':
                    
                    view.webview.postMessage({ command: 'restoreUser', user: user });
                    break;
                case 'logout':
                    authToken = undefined;
                    await this._context.globalState.update('lacyToken', undefined);
                    await this.clearSession();
                    await this.clearUser();
                    break;
                case 'login':
                    if (data.serverUrl && data.serverUrl !== serverUrl()) {
                        // Remember the server this person signed in to, so the rest
                        // of the panel and future sessions use it.
                        await vscode.workspace.getConfiguration('lacy')
                            .update('serverUrl', data.serverUrl, vscode.ConfigurationTarget.Global);
                        view.webview.html = getHtmlForWebview(this._extensionUri, view.webview);
                    }
                    authToken = data.token;
                    await this._context.globalState.update('lacyToken', data.token);
                    await this._context.globalState.update('user', data.user);
                    await this._context.globalState.update('userSession', data.userSession);
            
                    view.webview.postMessage({ command: 'restoreSession', userSession: data.userSession });
                    view.webview.postMessage({ command: 'restoreUser', user: data.user });
                    vscode.window.showInformationMessage(`Signed in to Lacy as ${data.user.email}.`);
                    //no break; to load files <3
                case 'webviewReady':
                    vscode.workspace.findFiles('**/*', '**/node_modules/**').then(files => {
                        const allowedExtensions = ['.c', '.h', '.ts', '.sql', '.js', '.css', '.html', '.py', '.java', '.cpp', '.php', '.vb', '.vbproj', '.xsc', '.xsd', '.xss', '.rdlc', '.aspx', '.php', '.myapp', '.resx', '.settings'];
                        
                        this.filePaths = files
                            .map(file => file.fsPath)
                            .filter(file => {
                                const lowerFile = file.toLowerCase();
                                // Exclude the unwanted README file
                                if (lowerFile.endsWith("readme.md")) return false;
                                // Only allow files with allowed code extensions
                                return allowedExtensions.some(ext => lowerFile.endsWith(ext));
                            })
                            .map(file => {
                                const relativePath = file.substring(this._basePath.length + this._projectName.length + 1);
                                // Always use "/" so paths mean the same thing on Windows,
                                // macOS and Linux, and match what the server stores.
                                return relativePath.split(path.sep).join('/');
                            });

                        this.sendFilesToWebview(this.filePaths);
                    });
                    break;
                
                case 'readProjectFiles': {
                    const contents = await this._readProjectFiles(data.files ?? []);
                    this._view?.webview.postMessage({
                        command: 'projectFilesContent',
                        requestId: data.requestId,
                        contents,
                    });
                    break;
                }

                case 'sendProjectFiles':
                    this._view?.webview.postMessage({
                        command: 'loadFilesEdit', files: this.filePaths, projectName: this._projectName,
                        projectKey: this._projectKey, basePath: this._basePath,
                    });
                    break;

                case 'runDevDashboard': {
                    const user = this.getUser();
                    if (!user || !user.id || !authToken) {
                        vscode.window.showErrorMessage('User is not logged in. Cannot open the dashboard.');
                        break;
                    }
                    try {
                        // A short-lived, single-use code, so no long-lived token ends up in the URL.
                        const response = await apiFetch('/api/auth/handoff', { method: 'POST' });
                        if (!response.ok) {
                            throw new Error(`Server returned ${response.status}`);
                        }
                        const { code } = await response.json() as { code: string };
                        vscode.env.openExternal(vscode.Uri.parse(`${serverUrl()}/my-tours?code=${code}`));
                    } catch (err) {
                        vscode.window.showErrorMessage('Could not open the dashboard. Is the Lacy server running?');
                    }
                    break;
                }

                case 'highlightInEditor':
                    const fullPath = path.join(this._basePath, this._projectName, data.filePath);
                    const file = vscode.Uri.file(fullPath);
                    const document = await vscode.workspace.openTextDocument(file);
                    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

                    const startPos = new vscode.Position(data.startLine - 1, 0);
                    const endPos = new vscode.Position(data.endLine, 0);

                    editor.selection = new vscode.Selection(startPos, endPos);
                    editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
                    break;
                
                case 'previewFile': {
                    // Opened as a preview tab and without taking focus, so clicking
                    // through several files does not pile up tabs or leave the panel.
                    const previewUri = vscode.Uri.file(path.join(this._basePath, this._projectName, data.filePath));
                    try {
                        const doc = await vscode.workspace.openTextDocument(previewUri);
                        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.One });
                    } catch (err) {
                        console.error('Could not open', previewUri.fsPath, err);
                    }
                    break;
                }

                case 'getFileContent':
                    try {
                        const filePath = data.filePath;
                        const fullPath = path.join(this._basePath, this._projectName, filePath);
                        
                        vscode.workspace.openTextDocument(vscode.Uri.file(fullPath)).then(document => {
                            const content = document.getText();
                            this._view?.webview.postMessage({
                                command: 'fileContent',
                                content: content,
                                filePath: filePath
                            });
                        });
                    } catch (error) {
                        this._view?.webview.postMessage({
                            command: 'fileContent',
                            content: 'Error: Unable to load file content',
                            filePath: data.filePath,
                            error: true
                        });
                    }
                    break;
                
                case 'startTour':
                    tourId = data.tourId;
                    await this._startTour(data.tourName.trim());
                    this._currentStepIndex = 0; // Reset to the first step
                    previousDecorationType = this._showCurrentStep(previousDecorationType);
                    break;
                    
                case 'peekTourInfo': {
                    const summary = await this._peekTourInfo(data.tourId);
                    this._view?.webview.postMessage({
                        command: 'showPeekedTourInfo',
                        tourName: data.tourName,
                        summary,
                    });
                    break;
                }
                    
                case 'readTourFile':
                    await this._readTourFile(data.filePath);
                    this._currentStepIndex = 0; // Reset to the first step
                    previousDecorationType = this._showCurrentStep(previousDecorationType);
                    break;

                case 'nextStep':
                    if (this._currentStepIndex < this._parsedRows.length - 1) {
                        this._currentStepIndex++;
                        previousDecorationType = this._showCurrentStep(previousDecorationType);
                    }
                    break;

                case 'prevStep':
                    if (this._currentStepIndex > 0) {
                        this._currentStepIndex--;
                        previousDecorationType = this._showCurrentStep(previousDecorationType);
                    }
                    break;

                case 'exitTour':
                    this._clearHighlights();
                    await this._logTourUsage(tourId, this.getUser().id, tourStartTime, new Date().toISOString(), this._parsedRows[this._currentStepIndex].id);
                    this._view?.webview.postMessage({ command: 'returnToMainPage' });
                    break;
                
                case 'completeTour': 
                    await this._logTourUsage(tourId, this.getUser().id, tourStartTime, new Date().toISOString(), this._parsedRows[this._currentStepIndex].id);
                    this._view?.webview.postMessage({ command: 'showQuiz' });
                   ////vscode.commands.executeCommand('workbench.action.closeAllEditors'); // Optional: Close all open files
                    break;
                case 'openTourTxt':
                    const fileUri = vscode.Uri.joinPath(this._extensionUri, data.filePath);
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc, { preview: false });
                    break;

                case 'editTourStep':
                    const stepIndex = this._parsedRows.findIndex(row => row.step === data.stepIndex);
                    if (stepIndex !== -1) {
                        this._currentStepIndex = stepIndex;
                        previousDecorationType = this._showCurrentStepEdit(previousDecorationType);
                    }
                    lineSelectionPossible= true;
                    previousDecorationType = this._showCurrentStepEdit(previousDecorationType);
                    break;
                
                case 'goToStepList':
                    this._startedTourName= data.tourName;
                    await this._startTour(this._startedTourName);
                    this._view?.webview.postMessage({ command: 'updateEditTourStepList', tourName: this._startedTourName, tourId: data.tourId });
                    break;
                
                case 'podcastTour':
                    const tour_data= data;
                    this._startedTourName= data.tourName;
                    await this._startTour(this._startedTourName);

                    // Open the first file with its steps highlighted; the panel brings
                    // others forward as the conversation mentions them.
                    lineSelectionPossible = false;
                    await this._showPodcastFile(this._parsedRows[0]?.file);

                    // Always answer the panel, even when something fails, so the
                    // podcast page shows the script or says why it cannot play.
                    {
                        const send = (transcript: string, indexes: number[]) => this._view?.webview.postMessage({
                            command: 'podcastTourTranscript',
                            transcript,
                            parsedSteps: this._parsedRows,
                            tourName: this._startedTourName,
                            isGuided: tour_data.isGuided,
                            tourId: tour_data.tourId,
                            indexes,
                        });
                        let indexes: number[] = [];
                        let transcript = '';
                        try {
                            const res = await apiFetch(`/api/tours/${tour_data.tourId}/audio-segments`);
                            if (res.ok) indexes = (await res.json()) as number[];
                        } catch { /* shown as "no audio" */ }
                        try {
                            const res = await apiFetch(`/api/tours/${tour_data.tourId}/audio_text`);
                            if (res.ok) {
                                const body = (await res.json()) as { success: boolean; audio_text: string };
                                if (body.success) transcript = body.audio_text || '';
                            }
                        } catch { /* shown as "no podcast" */ }
                        send(transcript, indexes);
                    }

                    // Create one whole transcript from the description of each _parsedRow item
                                       
                    // Optionally, send the transcript to the webview or save it somewhere
                    
                    break;
                    
                case 'podcastFocusFile':
                    await this._showPodcastFile(data.file);
                    break;

                case 'podcastClosed':
                    this._clearHighlights();
                    break;

                case 'saveTourStepInList':
                    lineSelectionPossible = false;
                    await this._saveTourStep(data.id, data.body);
                    break;
                
                case 'storeEditHistory':
                    await this._storeEditHistory(data.tourId, this.getUser().id, data.numberOfEditedSteps, data.startTime, data.endTime, data.actionType);
                    break;

                case 'saveTourStepManual':
                    const index = this._parsedRows.findIndex(step => String(step.id) === String(data.id));
                    if(index!==-1){
                        this._parsedRows[index].description= data.description;
                        this._parsedRows[index].interval= `${data.body.line_start}-${data.body.line_end}`;
                    }
                    break;
                
                case 'createTourStep':
                    await this._createTourStep(this._startedTourName, data.body);
                    await this._startTour(this._startedTourName);
                    this._view?.webview.postMessage({ command: 'renderTourStepsSuccess' });
                    break;
                
                case 'createTourManual':
                    this._projectName = data.body.project_name;
                    this._user_id= data.body.user_id;
                    this._parsedRows = [];
                    this._view?.webview.postMessage({ command: 'createManualTour', body: data.body });
                    break;
                
                case 'createTourStepManual':
                    this._parsedRows.push({
                        id: data.body.id,
                        step: data.body.step_number,
                        file: data.body.file_path,
                        interval: `${data.body.line_start}-${data.body.line_end}`,
                        description: data.body.description,
                    });
                    break;
                
                case 'saveManualTour':
                    const manualTourId = await this._createNewTour(
                        {
                            name: data.body.name,
                            user_id: this._user_id,
                            project_name: this._projectName,
                            project_key: this._projectKey,
                            isGuided:1,
                            target_department: data.body.target_department,
                            created_at: new Date().toISOString()
                        }
                    );
                    for (const step of data.body.steps) {
                        await this._createTourStep(
                            data.body.name,
                            {
                                step_number: step.step_number,                                
                                description: step.description,
                                file_path: step.file_path,
                                line_start: step.line_start,
                                line_end: step.line_end,
                                created_at: new Date().toISOString()
                            }
                        );
                    }
                    this._view?.webview.postMessage({ command: 'addQuiz', tourId: manualTourId, tourName: data.body.name });
                    break;
                
                case 'reorderTourSteps':
                    await this._reorderTourSteps(data.steps, data.willSave);
                    this._view?.webview.postMessage({ command: 'renderTourStepsSuccess' });
                    break;
                
                case 'updateTourTitle':
                    this._updateTourTitle(data.newTitle);
                    break;
                
                case 'updateSelectedFile':
                    // Close the previously opened file tab
                    const selectedFileUri = vscode.Uri.file(path.join(this._basePath, this._projectName, ...data.filePath.split(/[\\/]/)));
                    const selectedDoc = await vscode.workspace.openTextDocument(selectedFileUri);
                    
                    if (data.preview) {
                        await vscode.window.showTextDocument(selectedDoc, { 
                            preview: true, 
                            preserveFocus: true 
                        });
                    } else {
                        await vscode.window.showTextDocument(selectedDoc, { preview: false });
                        lineSelectionPossible = true;
                    }
                    break;
                
                case 'completeQuiz': 
                    this._clearHighlights();
                    this._view?.webview.postMessage({ command: 'renderFeedbackPage', tourName: data.tourName });
                    break;

                case 'deleteTour':
                    // Its steps may be highlighted in open editors; take those off.
                    this._clearHighlights();
                    await this._deleteTour(data.tour_id);
                    if(data.tour_type){
                        this._view?.webview.postMessage({ command: 'tourDeleted', tour_id: data.tour_id, tour_type: data.tour_type });
                    }
                    else{
                        this._view?.webview.postMessage({ command: 'tourDeleted', tour_id: data.tour_id });
                    }
                    break;

                case 'deleteTourStep':
                    this._clearHighlights();
                    await this._deleteTourStep(data.id);
                    this._view?.webview.postMessage({ command: 'renderTourStepsSuccess'});
                    break;

                case 'createTourRecord': {
                    const response = await apiFetch('/api/auth/handoff', { method: 'POST' });
                    if (!response.ok) {
                        vscode.window.showErrorMessage('Could not open the recorder. Is the Lacy server running?');
                        break;
                    }
                    const { code } = await response.json() as { code: string };
                    vscode.env.openExternal(vscode.Uri.parse(`${serverUrl()}/record-audio/${data.stepId}?code=${code}`));
                    break;
                }

                case 'updateTourStepWithTranscription':
                    // The webview asked the extension to start recording for a specific step
                    // Store pending step id for when the transcription arrives
                    this._pendingStepIndex = data.stepIndex;

                    // Find parsedRows entry that has matching id
                    const parsedIndex = this._parsedRows.findIndex(r => Number(r.id) === Number(data.stepIndex));
                    if (parsedIndex !== -1) {
                        try {
                            const stepId = data.stepIndex;
                            const resp = await apiFetch(`/api/get-tour-step-by-id?id=${stepId}`);                            
                            if (!resp.ok) {
                                const text = await resp.text().catch(() => '');
                                throw new Error(`Failed to fetch tour step ${stepId}. ${text}`);
                            }

                            const stepData: any = await resp.json();

                            // Normalize values and update local parsedRows entry
                            const lineStart = stepData.line_start ?? stepData.lineStart ?? (() => {
                                // try to parse from existing interval if available
                                const match = (this._parsedRows[parsedIndex]?.interval || '').split('-')[0];
                                return match ? Number(match) : 1;
                            })();
                            const lineEnd = stepData.line_end ?? stepData.lineEnd ?? (() => {
                                const parts = (this._parsedRows[parsedIndex]?.interval || '').split('-');
                                return parts[1] ? Number(parts[1]) : lineStart;
                            })();

                            this._parsedRows[parsedIndex] = {
                                ...this._parsedRows[parsedIndex],
                                id: stepData.id ?? this._parsedRows[parsedIndex].id,
                                step: stepData.step_number ?? this._parsedRows[parsedIndex].step,
                                file: stepData.file_path ?? this._parsedRows[parsedIndex].file,
                                interval: `${lineStart}-${lineEnd}`,
                                description: stepData.description ?? this._parsedRows[parsedIndex].description,
                                tour_id: stepData.tour_id ?? this._parsedRows[parsedIndex].tour_id,
                                transcription: stepData.transcription ?? stepData.audio_text ?? this._parsedRows[parsedIndex].transcription ?? null,
                                questions: stepData.questions ?? this._parsedRows[parsedIndex].questions ?? []
                            };

                            // Notify the webview that the step was fetched and updated
                            this._view?.webview.postMessage({
                                command: 'tourDescriptionReady',
                                step: this._parsedRows[parsedIndex].description
                            });

                            // Open the recorder panel so the user can record (recorder will post back insertTranscript)
                        } catch (err: any) {
                            this._view?.webview.postMessage({
                                command: 'tourStepFetchFailed',
                                error: err?.message ?? String(err)
                            });
                        }
                    }
                    // Open the recorder panel (will post back 'insertTranscript' with base64)
                    break;

                case 'turnOnLineSelection':
                    lineSelectionPossible = true;
                    break;

                case 'turnOffLineSelection':
                    lineSelectionPossible = false;
                    //DO NOT PUT A CASE RIGHT BELOW THIS, IT ENTERS THE CASE BELOW RN

                case 'resetTourFormAndSelections':
                    this._clearHighlights();
                    this._view?.webview.postMessage({ command: 'resetTourFormAndSelections' });
                    break;

                case 'loadUserGuidedTours':
                    this._view?.webview.postMessage({ command: 'loadUserGuidedTours'});
                    break;

                case 'showError':
                    vscode.window.showErrorMessage(data.text);
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(data.text);
                    break;

                case 'submitQuestion': {
                
                    const { question, stepNo, tourId, userId } = data;
                    if (!question || !stepNo || !tourId || !userId) {
                        this._view?.webview.postMessage({
                            command: 'questionFailed',
                            error: 'Missing one or more required fields.'
                        });
                        break;
                    }
                
                    try {
                        const response = await apiFetch(`/api/submit-question`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                question,
                                step_no: stepNo,
                                tour_id: tourId,
                                user_id: userId
                            })
                        });
                
                        const result = await response.json() as { success: boolean; question_id?: number; error?: string };
                
                        if (result.success) {
                            this._view?.webview.postMessage({ 
                                command: 'questionSubmitted', 
                                question: data.question 
                            });
                        } else {
                            this._view?.webview.postMessage({ command: 'questionFailed', error: result.error });
                        }
                    } catch (err: any) {
                        this._view?.webview.postMessage({
                            command: 'questionFailed',
                            error: 'Network error or server unreachable'
                        });
                    }
                
                    break;
                }
                //Cases for audio recording feature !!
                case "activateAudioTab":
                    this._view?.webview.postMessage({ command: "activateAudioTab" });
                    break;
                
                case "startNodeRecording":
                    this.recordingActive = true;

                    // files are now selected in the frontend
                    this.recordingSelectedFiles = data.selectedFiles ?? [];

                    await this.startNodeRecording();
                    break;

                case 'stopNodeRecording':
                    this.recordingActive = false;
                    await this.stopNodeRecording();
                    break;
                
                case "submitAudioTour":
                    await this.transcribeAndCreateAudioTour({
                        audioChunks: data.audioChunks,
                        name: data.name,
                        tour_focus: data.tour_focus,
                        llmModel: data.llmModel,
                        projectKnowledge: data.projectKnowledge,
                        targetDepartment: data.targetDepartment,
                        selectedFiles: data.selectedFiles,
                        mimeType: data.mimeType,
                    });
                    break;
                }
        });
    }
    //Session management functions
    private async storeSession(userSession: any) {
        await this._context.globalState.update("userSession", userSession);
    }    

    private getSession(): any {
        return this._context.globalState.get("userSession");
    }

    private async clearSession() {
        await this._context.globalState.update("userSession", undefined);
    }

    public sendFilesToWebview(files: string[]) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'loadFiles', files, projectName: this._projectName,
                projectKey: this._projectKey, basePath: this._basePath,
            });
        }
    }

    private getUser(): any {
        return this._context.globalState.get("user");
    }
    private async storeUser(user: any) {
        await this._context.globalState.update("user", user);
    }
    private async clearUser() {
        await this._context.globalState.update("user", undefined);
    }
    private _clearHighlights() {
        clearAllLacyHighlights();
    }

    /**
     * For a podcast: show one of the tour's files with every step in it
     * highlighted (found by content, as in a tour), replacing the last one shown.
     */
    private async _showPodcastFile(file: string | undefined) {
        const rows = (this._parsedRows || []).filter((row: any) => row.file === file && row.interval);
        if (!file || rows.length === 0) return;
        const uri = vscode.Uri.file(path.join(this._basePath, this._projectName, ...file.split(/[\\/]/)));
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        } catch {
            return; // Not in this checkout; the podcast still plays.
        }
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const text = doc.getText();
        const ranges = rows.map((row: any) => {
            const [start, end] = row.interval.split('-').map((n: string) => parseInt(n.trim(), 10));
            const located = locateStep(text, row.anchorText, start, end);
            return new vscode.Range(located.startLine - 1, 0, located.endLine, 0);
        });
        clearAllLacyHighlights();
        editor.setDecorations(lacyHighlight(), ranges);
        editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
    }

    /**
     * Read project files so the server can generate a tour without needing access
     * to this machine's disk (it may run in a container or on another host).
     */
    /** The code a hand-written step points at, so it can be found again later. */
    private async _anchorTextForStep(relativePath: string, lineStart: number, lineEnd: number): Promise<string | null> {
        if (!relativePath || !lineStart || !lineEnd) return null;
        const fullPath = path.join(this._basePath, this._projectName, ...String(relativePath).split(/[\\/]/));
        try {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            return anchorTextFor(content, Number(lineStart), Number(lineEnd));
        } catch (err) {
            console.error(`Could not read ${fullPath} to anchor the step:`, err);
            return null;
        }
    }

    private async _readProjectFiles(relativePaths: string[]): Promise<Record<string, string>> {
        const contents: Record<string, string> = {};
        for (const relativePath of relativePaths) {
            const fullPath = path.join(this._basePath, this._projectName, ...relativePath.split(/[\\/]/));
            try {
                contents[relativePath] = await fs.promises.readFile(fullPath, 'utf8');
            } catch (err) {
            console.error('Unexpected error:', err);
        }
        }
        return contents;
    }

    private async _reorderTourSteps(steps: { id: number; step_number: number }[], willSave: boolean) {
        try {
            const updatedRows = [...this._parsedRows];

            // Iterate through the steps array
            for (const step of steps) {
                const { id, step_number } = step;

                // Update the step_number in _parsedRows
                const rowIndex = this._parsedRows.findIndex(row => Number(row.id) === Number(id));
                if (rowIndex !== -1) {
                    if (rowIndex !== -1 && updatedRows[rowIndex].step !== step_number) {
                        
                        // Create a new object with the updated step
                        updatedRows[rowIndex] = {
                            ...updatedRows[rowIndex],
                            step: step_number
                        };

                        if(willSave){
                        
                            // Send a PATCH request to update the step_number for each step
                            const response = await apiFetch(`/api/update-step-number/${id}`, {
                                method: 'PATCH',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ step_number }),
                            });
                
                            if (!response.ok) {
                                continue; // Skip to the next step if this one fails
                            }
                        }  
                    }
                }
        }
    
        // Keep the in-memory rows in step order, so Next/Back follow the new order.
        this._parsedRows = updatedRows.sort((a, b) => Number(a.step) - Number(b.step));
        
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _startTour(tourName: string) {
        try {
            // Fetch the tour steps from the server
            tourStartTime = new Date().toISOString();
            const user = this.getUser();
            const response = await apiFetch(`/api/get-tour-steps?tourName=${encodeURIComponent(tourName.trim())}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch tour steps');
            }
            const tourSteps: TourStep[] = await response.json() as TourStep[];
            
            if (tourSteps.length > 0) {
                this._isGuided = tourSteps[0].isGuided ?? 1; // or 0
            }

            this._parsedRows = [];

            const groupedSteps = new Map<number, any>();

            for (const step of tourSteps) {
                if (!groupedSteps.has(step.id)) {
                    groupedSteps.set(step.id, {
                        id: step.id,
                        step: step.step_number,
                        file: step.file_path,
                        interval: `${step.line_start}-${step.line_end}`, // ✅ This is correct
                        anchorText: step.anchor_text ?? null,
                        description: step.description,
                        tour_id: step.tour_id,
                        questions: [],
                    });
                }
                if (step.question) {
                    groupedSteps.get(step.id).questions.push({
                        question: step.question,
                        answer: step.answer || null
                    });
                }
            }

            this._parsedRows = Array.from(groupedSteps.values());
    
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _logTourUsage(tourId: number, userId: number, startTime: string, endTime: string, exitStepId: number) {
    try {
        const response = await apiFetch(`/api/log-tour-usage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tour_id: tourId, user_id: userId, enter_timestamp: startTime, exit_timestamp: endTime, exit_step_id: exitStepId }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error('Failed to log tour usage');
        }

        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _storeEditHistory(tourId: number, userId: number, numberOfEditedSteps: number, startTime: string, endTime: string, actionType: string) {
        try {
            const response = await apiFetch(`/api/log-edit-history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tour_id: tourId, user_id: userId, start_time: startTime, end_time: endTime, number_of_edit_actions: numberOfEditedSteps }),
            });

            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error('Failed to store edit history');
            }

        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _peekTourInfo(tourId: number) {
        try {
            const response = await apiFetch(`/api/tour-summary?tourId=${encodeURIComponent(String(tourId))}`);
            if (!response.ok) {
                throw new Error('Failed to fetch tour info');
            }
            const tourInfo = await response.json();
            return tourInfo;
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _startQuiz(tourName: string) {
        try {
            // Fetch the tour steps from the server
            const response = await apiFetch(`/api/get-quiz-questions?tourName=${encodeURIComponent(tourName)}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch quiz questions');
            }
    
            const quizQuestions: QuizQuestion[] = await response.json() as QuizQuestion[];
            // Process the fetched steps data
            this._parsedRows = quizQuestions.map((question: QuizQuestion) => {
                return {
                    //tour id and question id are not used here beware
                    question: question.question,
                    score: question.score,
                    options: question.options,
                    answers: question.answers,
                    question_type: question.question_type
                };
            });
    
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _readTourFile(filePath: string) {
        const tourFileUri = vscode.Uri.joinPath(this._extensionUri, filePath);

        try {
            const doc = await vscode.workspace.openTextDocument(tourFileUri);
            const content = doc.getText();

            const lines = content.split('\n');
            const dataLines = lines.slice(2); // Skip header and separator

            this._parsedRows = dataLines.map((line) => {
                const [step, file, file_parts, interval, description] = line.split('|').map((part) => part.trim());
                return { step, file, file_parts, interval, description };
            });

        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _deleteTour(tour_id: Number) {
        try {
            const response = await apiFetch(`/api/delete-tour/${tour_id}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error || `Server returned ${response.status}`);
            }

            this._view?.webview.postMessage({
                command: 'deleteTourResponse',
                success: true
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Could not delete the tour: ${error?.message ?? error}`);
            this._view?.webview.postMessage({
                command: 'deleteTourResponse',
                success: false,
            });
        }
    }

    private async _deleteTourStep(id: number) {
        try {
    
            // Send a DELETE request to the server
            const response = await apiFetch(`/api/delete-tour-step/${id}`, {
                method: 'DELETE',
            });
    
            // Check if the response is successful
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }
    
    private async _saveTourStep(id: number, body: any) {
        try {
            const row = this._parsedRows.find((r) => String(r.id) === String(id));
            if (row?.file && body.line_start && body.line_end) {
                body = {
                    ...body,
                    anchor_text: await this._anchorTextForStep(row.file, body.line_start, body.line_end),
                };
            }
            const response = await apiFetch(`/api/edit-tour-step/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error('Failed to save tour step');
            }

            // Update the local _parsedRows array
            const index = this._parsedRows.findIndex(row => row.id === id);
            if (index !== -1) {
                this._parsedRows[index] = {
                    ...this._parsedRows[index],
                    description: body.description,
                    interval: `${body.line_start}-${body.line_end}`
                };
            }
        } catch (error) {
            console.error('Unexpected error:', error);
        }
    }

    private async _createTourStep(tourName: string, body: any) {
        try {
            body = {
                ...body,
                anchor_text: await this._anchorTextForStep(body.file_path, body.line_start, body.line_end),
            };
            const response = await apiFetch(`/api/create-tour-step/${encodeURIComponent(tourName)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
    
            if (!response.ok) {
                const errorMsg = await response.text();
                vscode.window.showErrorMessage('Failed to create tour step.');
                return;
            }
    
            const result = await response.json();
    
            vscode.window.showInformationMessage('Tour step created successfully.');
    
        } catch (error) {
            vscode.window.showErrorMessage('An error occurred while creating the tour step.');
        }
    }

    private async _createNewTour(body: any) {
        try {
            const response = await apiFetch(`/api/create-tour-manual`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorMsg = await response.text();
                vscode.window.showErrorMessage('Failed to create tour.');
                return;
            }

            const result = await response.json();
            if (typeof result === 'object' && result !== null && 'tourId' in result) {
                return result.tourId;
            }

            vscode.window.showInformationMessage('Tour created successfully.');

        } catch (error) {
            vscode.window.showErrorMessage('An error occurred while creating the tour.');
        }
    }

    private async transcribeAndCreateAudioTour(payload: {
        audioChunks: string[],
        name: string,
        tour_focus: string,
        llmModel: string,
        projectKnowledge: string,
        targetDepartment: string,
        selectedFiles: string[];
        /** webm when the panel recorded, wav when SoX did. */
        mimeType?: string;
    }) {
        try { 
            let fullTranscript = "";

            for (let i = 0; i < payload.audioChunks.length; i++) {
                const result = await transcribeAudio(payload.audioChunks[i], payload.mimeType || 'audio/wav');

                if (!result.success) {
                    vscode.window.showErrorMessage(
                        `Transcription failed at minute ${i + 1}: ${result.error ?? 'unknown error'}`
                    );
                    return;
                }

                fullTranscript += result.transcript.trim() + "\n";
            }

            const transcript = fullTranscript.trim();

            const tourData = {
                name: payload.name,
                description: transcript,
                tour_focus: payload.tour_focus,

                files: payload.selectedFiles,
                file_contents: await this._readProjectFiles(payload.selectedFiles),
                file_parts: {},

                isGuided: 1,
                projectKnowledge: payload.projectKnowledge ?? "low",
                targetDepartment: payload.targetDepartment ?? null,
                create_Quiz: 0,
                create_audio: false,
                llmModel: payload.llmModel,

                user_id: this.getUser()?.id,
                basePath: this._basePath,
                projectName: this._projectName,
                projectKey: this._projectKey
            };

            const response = await apiFetch(`/api/create-tour`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tourData)
            });
            let resultJson: any;

            if (!response.ok) {
                let errorBody = "";
                try {
                    errorBody = await response.text();
                } catch (err) {
            console.error('Unexpected error:', err);
        }
                let detail = errorBody;
                try {
                    detail = (JSON.parse(errorBody) as { error?: string; message?: string }).error
                        || (JSON.parse(errorBody) as { message?: string }).message
                        || errorBody;
                } catch {
                    // keep the raw body
                }
                vscode.window.showErrorMessage(`Could not create the voice tour: ${detail || response.status}`);
                this._view?.webview.postMessage({ command: 'audioTourFailed', error: detail });
            }
            else{
                resultJson = await response.json();
                const newTourName = resultJson.name;

                this._view?.webview.postMessage({
                    command: "audioTourCreated",
                    transcript,
                    newTourName,
                    tourId: resultJson.tourId
                });
            }
        } catch (err) {
            vscode.window.showErrorMessage("Failed to create audio-based tour.");
            this._view?.webview.postMessage({ command: 'audioTourFailed', error: String(err) });
        }
    }

    private _updateTourTitle(tourName: string) {
        // Update the local _parsedRows array
        // Send the updated tour name to the webview
        apiFetch(`/api/update-tour-name`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
            currentTourName: this._startedTourName,
            newTourName: tourName.trim(),
            }),
        })
        .then(response => {
            if (!response.ok) {
            throw new Error('Failed to update tour name');
            }
            return response.json();
        })
        .then(data => {
            this._startedTourName=tourName.trim();
            this._parsedRows = this._parsedRows.map(row => {
                return {
                    ...row,
                    tourName: tourName
                };
            }); // Update the local tour name
        })
        .catch(error => {
            vscode.window.showErrorMessage('Failed to update tour name. Please try again.');
        });
    }

    private _showCurrentStep(previousDecorationType: vscode.TextEditorDecorationType | undefined) {

        if (!this._parsedRows || this._parsedRows.length === 0) {
            return previousDecorationType;
        }
        const row = this._parsedRows[this._currentStepIndex];

        if (!row || !row.interval) {
            return previousDecorationType;
        }
    
        const [startLine, endLine] = row.interval.split('-').map((line: string) => parseInt(line.trim(), 10) - 1);
    
        const tourFilePath = vscode.Uri.file(path.join(this._basePath, this._projectName, ...row.file.split(/[\\/]/)));
    
        // One step highlighted at a time: take the previous step's off first.
        clearAllLacyHighlights();
        const highlightDecoration = lacyHighlight();
    
        vscode.workspace.openTextDocument(tourFilePath).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: false }).then((editor) => {
                // The file may have been edited, or the reader may be on another
                // branch, so find the step's code by content rather than trusting
                // the stored line numbers.
                const located = locateStep(doc.getText(), row.anchorText, startLine + 1, endLine + 1);
                const shownStart = located.startLine - 1;
                const shownEnd = located.endLine - 1;
                const warning = anchorWarning(located.status, row.file);
                if (warning) {
                    console.warn(warning);
                }
                // Let the tour's author know what readers are actually finding.
                if (row.id && located.status !== 'unknown') {
                    apiFetch('/api/report-step-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ step_id: row.id, status: located.status }),
                    }).catch((err) => console.error('Could not report step status:', err));
                }

                // endLine is inclusive, so the range has to reach the start of the next line.
                const range = new vscode.Range(shownStart, 0, shownEnd + 1, 0);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    
                if (previousDecorationType) {
                    previousDecorationType.dispose();
                }
    
                editor.setDecorations(highlightDecoration, [range]);
    
                const isFirstStep = this._currentStepIndex === 0;
                const isLastStep = this._currentStepIndex === this._parsedRows.length - 1;
    
                const messagePayload = {
                    command: 'updateTourStep',
                    step: row.step,
                    startLine: shownStart,
                    endLine: shownEnd,
                    anchorStatus: located.status,
                    anchorWarning: warning,
                    content: row.description,
                    tourId: row.tour_id,
                    questions: row.questions,
                    isGuided: this._isGuided,
                    buttons: {
                        showNext: !isLastStep,
                        showBack: !isFirstStep,
                        showComplete: isLastStep,
                    },
                    showExit: true,
                    totalSteps: this._parsedRows.length,
                };
                
                this._view?.webview.postMessage(messagePayload);                
            });
        }, (err) => {
            vscode.window.showErrorMessage(
                `This tour step points at "${row.file}", which is not in this project. `
                + 'The file may have been renamed or deleted since the tour was created.'
            );
            this._view?.webview.postMessage({
                command: 'tourStepFileMissing',
                step: row.step,
                file: row.file,
            });
        });
    
        return highlightDecoration;
    }
    
    private _showCurrentStepEdit(previousDecorationType: vscode.TextEditorDecorationType | undefined) {
        const row = this._parsedRows[this._currentStepIndex];
        const [startLine, endLine] = row.interval.split('-').map((line: string) => parseInt(line.trim(), 10) - 1);
        
        const tourFilePath = vscode.Uri.file(path.join(this._basePath, this._projectName, ...row.file.split(/[\\/]/)));

        // One step highlighted at a time: take the previous step's off first.
        clearAllLacyHighlights();
        const highlightDecoration = lacyHighlight();

        vscode.workspace.openTextDocument(tourFilePath).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: false }).then((editor) => {
                const range = new vscode.Range(startLine, 0, endLine+1, 0);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

                if (previousDecorationType) {
                    previousDecorationType.dispose();
                }

                editor.setDecorations(highlightDecoration, [range]);
                
                const isFirstStep = this._currentStepIndex === 0;
                const isLastStep = this._currentStepIndex === this._parsedRows.length - 1;

            });
        });
        let currentDecorationType: vscode.TextEditorDecorationType | undefined;
        currentDecorationType = highlightDecoration;
        return currentDecorationType;
    }
    //Audio recording functions !!!!!
    private async startNodeRecording() {
        if (!this._view) { return; }
        if (this._recorder) {return;}

        // Without SoX the recorder writes empty files and the server later says
        // "No audio received", so check for it first and say what to install.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const soxCheck = require('child_process').spawnSync('sox', ['--version']);
        if (soxCheck.error || soxCheck.status !== 0) {
            this._recordingFailed('VS Code did not allow the microphone in the panel, and SoX, which Lacy '
                + 'records with instead, is not installed. Install it (macOS: brew install sox, Windows: '
                + 'choco install sox, Linux: apt install sox), restart VS Code and record again.');
            return;
        }

        try {
            const storageDir = this._context.globalStorageUri.fsPath;
            await fs.promises.mkdir(storageDir, { recursive: true });

            const filePath = path.join(
                storageDir,
                `lacy-audio-${Date.now()}.wav`
            );
            const fileStream = fs.createWriteStream(filePath);

            // Loaded here rather than at startup: the SoX fallback is optional, and a
            // missing module must not stop the whole panel from loading.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const record = require('node-record-lpcm16');
            const rec = record.record({
                sampleRate: 16000,
                threshold: 0,
                verbose: false,
                recordProgram: 'sox' 
            });

            rec.stream().pipe(fileStream);

            this._recorder = rec;
            this._recordingFilePath = filePath;

            const wf = vscode.workspace.workspaceFolders?.[0];
            if (wf) {
                // _basePath is the folder CONTAINING the project, matching the constructor;
                // setting it to the project itself used to break every later step path.
                this._projectName = path.basename(wf.uri.fsPath);
                this._basePath = path.dirname(wf.uri.fsPath) + path.sep;
            }

            this._view.webview.postMessage({
                command: 'nodeRecordingStarted'
            });

        } catch (err) {
            vscode.window.showErrorMessage(
                'Could not start recording. Lacy records audio with SoX: install it and make sure '
                + '"sox" is on your PATH (macOS: brew install sox, Windows: choco install sox, Linux: apt install sox).'
            );
        }
    }

    /** Tell the person why recording stopped, and let the panel reset its recorder. */
    private _recordingFailed(message: string) {
        vscode.window.showErrorMessage(message);
        this._view?.webview.postMessage({ command: 'nodeRecordingFailed', error: message });
    }

    private async stopNodeRecording() {
        if (!this._view) { return; }
        if (!this._recorder || !this._recordingFilePath) {
            return;
        }

        const rec = this._recorder;
        const filePath = this._recordingFilePath;

        this._recorder = null;
        this._recordingFilePath = null;

        rec.stop();

        try {
            // Wait a tiny bit so the file stream finishes
            await new Promise(res => setTimeout(res, 300));

            const buf = await fs.promises.readFile(filePath);
            // A WAV header alone is 44 bytes: nothing was captured.
            if (buf.length <= 44) {
                fs.promises.unlink(filePath).catch(() => undefined);
                // The panel decides: fine if earlier pieces hold the recording,
                // otherwise it says this in its status line.
                this._view.webview.postMessage({
                    command: 'nodeRecordingFailed',
                    empty: true,
                    error: 'Nothing was recorded. Check that VS Code may use the microphone '
                        + '(System Settings → Privacy & Security → Microphone) and try again.',
                });
                return;
            }
            const base64 = buf.toString('base64');

            this._view.webview.postMessage({
                command: 'nodeRecordingFinished',
                audioBase64: base64,
                mimeType: 'audio/wav'
            });

        } catch (err) {
            vscode.window.showErrorMessage('Failed to read recorded audio.');
        }
    }
}
export function deactivate() {
    clearAllLacyHighlights();
}
