import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as sbar         from './display';
import {SidebarProvider} from './display';
import * as itms         from './display';
import {Item, WsAndFolderItem, FileItem, FuncItem} 
                         from './display';
import * as gutt         from './marks';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');

export function activate(context: vscode.ExtensionContext) {
  start('extension');

////////////  COMMANDS  ////////////
  
	const toggleCmd = vscode.commands.registerCommand(
           'vscode-function-explorer.toggle', async () => {
		await cmds.toggleCmd();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-explorer.prev', async () => {
		await cmds.prev();
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-explorer.next', async () => {
		await cmds.next();
	});

	const toggleMarkedFilter = vscode.commands.registerCommand(
       'vscode-function-explorer.toggleMarkedFilter', (fileItem: FileItem) => {
		sbar.toggleMarkedFilter(fileItem);
	});

	const toggleMarkedFilterMenu = vscode.commands.registerCommand(
   'vscode-function-explorer.toggleMarkedFilterMenu', (fileItem: FileItem) => {
		sbar.toggleMarkedFilter(fileItem);
	});

	const toggleAlphaSort = vscode.commands.registerCommand(
          'vscode-function-explorer.toggleAlphaSort', (fileItem: FileItem) => {
		sbar.toggleAlphaSort(fileItem);
	});

	const toggleAlphaSortMenu = vscode.commands.registerCommand(
      'vscode-function-explorer.toggleAlphaSortMenu', (fileItem: FileItem) => {
		sbar.toggleAlphaSort(fileItem);
	});

	const removeMarks = vscode.commands.registerCommand(
                      'vscode-function-explorer.removeMarks', async (item: Item) => {
		await sbar.removeMarks(item);
	});

	const removeMarksMenu = vscode.commands.registerCommand(
                  'vscode-function-explorer.removeMarksMenu', async (item: Item) => {
		await sbar.removeMarks(item);
	});

	const toggleItemMark = vscode.commands.registerCommand(
		'vscode-function-explorer.toggleItemMark', async (funcItem: FuncItem) => {
		await cmds.toggleItemMarkCmd(funcItem);
	});

	const funcClickCmd = vscode.commands.registerCommand(
                       'vscode-function-explorer.funcClickCmd', async (key) => {
		await cmds.funcClickCmd(key);
	});

////////////  SETTINGS  ////////////

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('function-explorer')) {
      sett.loadSettings();
      side.setFileWatcher();
      cmds.updateSide();
    }
  });

////////////  SIDEBAR  ////////////

  const sidebarProvider = new SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  const sidebarVisChg = treeView.onDidChangeVisibility(() => {
     // boolean whether the sidebar is now visible
  });

  const treeSelChg = treeView.onDidChangeSelection(() => {
     // item selection[]
  });

  const itemExpandChg = treeView.onDidExpandElement(async event => {
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(async event => {
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => { if(editor) await cmds.editorChg(editor); });

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(
    async event => {
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
  sbar.activate(treeView, sidebarProvider);
  itms.activate(context);
  cmds.updateSide();

	context.subscriptions.push(
    toggleCmd, prev, next, funcClickCmd, loadSettings,
    editorChg, selectionChg, textChg, toggleItemMark,
    sidebarVisChg, treeSelChg, itemExpandChg, itemCollapseChg,
    toggleMarkedFilter, toggleAlphaSort, removeMarks,
    toggleMarkedFilterMenu, toggleAlphaSortMenu, removeMarksMenu
  );

  end('extension');
}

export function deactivate() {
  log('extension deactivated');
}