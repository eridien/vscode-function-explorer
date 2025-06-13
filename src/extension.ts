import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as fnct         from './funcs';
import * as file         from './files';
import * as sbar         from './sidebar';
import {SidebarProvider} from './sidebar';
import * as itms         from './items';
import {WsFolderItem, FolderItem, FileItem}
                         from './items';
import * as gutt         from './gutter';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');

export async function activate(context: vscode.ExtensionContext) {
  start('extension');

////////////  COMMANDS  ////////////
  
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
                   'vscode-function-explorer.funcClickCmd', async (id) => {
		await sbar.funcClickCmd(id);
	});

////////////  SETTINGS  ////////////

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(async event => {
    if (event.affectsConfiguration('function-explorer')) {
      sett.loadSettings();
      file.setFileWatcher();
      await cmds.updateSide();
    }
  });

////////////  SIDEBAR  ////////////

  const sidebarProvider = new SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  const sidebarVisChg = treeView.onDidChangeVisibility(event => {
     // boolean whether the sidebar is now visible
  });

  const treeSelChg = treeView.onDidChangeSelection(event => {
     // item selection[]
  });

  const itemExpandChg = treeView.onDidExpandElement(event => {
    sbar.itemExpandChg(event.element as WsFolderItem | FolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(event => {
    sbar.itemExpandChg(event.element as WsFolderItem | FolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => { if(editor) await cmds.editorChg(editor); });

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(async event => {
    if (event.textEditor?.document.uri.scheme !== 'file') return;
    await cmds.selectionChg(event);
  });

  const textChg = vscode.workspace.onDidChangeTextDocument(async event => {
    if (vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document) {
      await cmds.textChg(event);
    }
  });

////////////  INIT  ////////////

  sett.loadSettings();
  gutt.activate(context);
  file.setFileWatcher();
  await sbar.activate(treeView, sidebarProvider, context);
  itms.activate(context);
  await fnct.activate(context);
  await cmds.updateSide();

	context.subscriptions.push(
    toggle, prev, next, funcClickCmd, loadSettings,
    editorChg, selectionChg, textChg,
    sidebarVisChg, treeSelChg, itemExpandChg, itemCollapseChg);

  end('extension');
}

export function deactivate() {
  log('extension deactivated');
}