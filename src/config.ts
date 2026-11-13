import * as vscode from 'vscode';

/** Base URL of the Lacy server, from the `lacy.serverUrl` setting. */
export function serverUrl(): string {
    const configured = vscode.workspace.getConfiguration('lacy').get<string>('serverUrl');
    return (configured || 'http://localhost:4000').replace(/\/+$/, '');
}
