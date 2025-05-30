import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as mrks   from './marks';
import * as gutt   from './gutter';

export async function activate(context: vscode.ExtensionContext) {
  await mrks.activate(context);
  await mrks.waitForInit();
  gutt.activate(context);
  gutt.updateGutter();
  
	const toggle = vscode.commands.registerCommand(
                'vscode-function-marks.toggle', async () => {
		await cmds.toggle();
	});

	context.subscriptions.push(toggle);
}

export function deactivate() {}
