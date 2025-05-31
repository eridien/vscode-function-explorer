import * as vscode from 'vscode';
import * as cmds   from './commands';
import * as mrks   from './marks';
import * as gutt   from './gutter';
import * as sett   from './settings';

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

  const refreshSettings = vscode.workspace
                    .onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('function-marks'))
        sett.refreshSettings();
    }
  );

	context.subscriptions.push(
    toggle, prev, next, refreshSettings);
}

export function deactivate() {}
