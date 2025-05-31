import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as mrks   from './marks';
import * as gutt   from './gutter';

export async function activate(context: vscode.ExtensionContext) {
  await mrks.activate(context);
  await mrks.waitForInit();
  gutt.activate(context);
  
	const toggle = vscode.commands.registerCommand(
                'vscode-function-marks.toggle', async () => {
		await cmds.toggle();
	});

	const prev = vscode.commands.registerCommand(
              'vscode-function-marks.prev', () => {
		cmds.prev();
	});

	const next = vscode.commands.registerCommand(
              'vscode-function-marks.next', () => {
		cmds.next();
	});

	context.subscriptions.push(toggle, prev, next);
}

export function deactivate() {}
