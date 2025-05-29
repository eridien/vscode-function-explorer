import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as gutt   from './gutter';

export function activate(context: vscode.ExtensionContext) {

  gutt.activate(context);
  // gutt.updateGutter();
	const toggle = vscode.commands.registerCommand(
                'vscode-function-marks.toggle', () => {
		cmds.toggle();
	});

	context.subscriptions.push(toggle);
}

export function deactivate() {}
