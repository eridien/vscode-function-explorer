import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as fnct         from './funcs';
import * as file         from './files';
import * as side         from './sidebar';
import {SidebarProvider} from './sidebar';
import * as gutt         from './gutter';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');

export async function activate(context: vscode.ExtensionContext) {
  start('extension');
  
	const toggle = vscode.commands.registerCommand(
           'vscode-function-explorer.toggle', async () => {
		await cmds.toggle();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-explorer.prev', async () => {
		await cmds.prev();
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-explorer.next', async () => {
		await cmds.next();
	});

	const funcClickCmd = vscode.commands.registerCommand(
                   'vscode-function-explorer.funcClickCmd', async () => {
		await side.funcClickCmd();
	});

	const fileClickCmd = vscode.commands.registerCommand(
                   'vscode-function-explorer.fileClickCmd', async (path) => {
		await side.fileClickCmd(path);
	});

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(async event => {
    if (event.affectsConfiguration('function-explorer')) {
      sett.loadSettings();
      file.setFileWatcher();
      await cmds.updateSide();
    }
  });

  const sidebarProvider = new SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  const chgSidebarVisibility = treeView.onDidChangeVisibility(event => {
    side.chgSidebarVisibility(event.visible);
  });

  const chgItemFocus = treeView.onDidChangeSelection(event => {
    if (event.selection.length > 0) {
      side.chgItemFocus(event.selection[0]);
    }
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => { if(editor) await cmds.editorChg(editor); });

  const chgEditorSel = vscode.window.onDidChangeTextEditorSelection(event => {
    if (event.textEditor?.document.uri.scheme !== 'file') return;
    cmds.chgEditorSel(event);
  });

  const textChg = vscode.workspace.onDidChangeTextDocument(async event => {
    if (vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document) {
      await cmds.textChg(event);
    }
  });

  sett.loadSettings();
  gutt.activate(context);
  file.setFileWatcher();
  await fnct.activate(context);
  await side.activate(treeView, sidebarProvider);
  await cmds.activate();

	context.subscriptions.push(
    toggle, prev, next, loadSettings, textChg, editorChg, fileClickCmd,
    chgSidebarVisibility, chgItemFocus, chgEditorSel, funcClickCmd);

  end('extension');
}

export function deactivate() {
  log('extension deactivated');
}