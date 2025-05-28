import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as parse  from './parse';

export function activate(context: vscode.ExtensionContext) {

	const toggle = vscode.commands.registerCommand(
                'vscode-function-labels.toggle', () => {
		cmds.toggle();
	});

	context.subscriptions.push(toggle);
}

export function deactivate() {}
