import * as vscode  from 'vscode';
import * as cmds    from './commands';
import * as mrks    from './marks';
import * as sidebar from './sidebar';
import * as gutt    from './gutter';
import * as sett    from './settings';

export async function activate(context: vscode.ExtensionContext) {
	const toggle = vscode.commands.registerCommand(
           'vscode-function-marks.toggle', async () => {
		await cmds.toggle();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-marks.prev', async () => {
		await cmds.prev();
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-marks.next', async () => {
		await cmds.next();
	});

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => { if(editor) await cmds.editorChg(editor); });

  const loadSettings = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('function-marks'))
        sett.loadSettings();
    }
  );

  const textChg = vscode.workspace.onDidChangeTextDocument(async event => {
    if (vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document) {
      await cmds.textChg(event);
    }
  });

  const sidebarProvider = new sidebar.SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  sett.loadSettings();
  await mrks.activate(context);
  await mrks.waitForInit();
  await mrks.initMarks();
  gutt.activate(context);
  sidebar.init(treeView);

	context.subscriptions.push(
    toggle, prev, next, loadSettings, textChg, editorChg);
}

export function deactivate() {}
