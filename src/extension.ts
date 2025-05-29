import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as gutt   from './gutter';
import * as parse  from './parse';

export function activate(context: vscode.ExtensionContext) {

  gutt.activate(context);

	const toggle = vscode.commands.registerCommand(
                'vscode-function-marks.toggle', () => {
		cmds.toggle();
	});

	context.subscriptions.push(toggle);
}

export function deactivate() {}
