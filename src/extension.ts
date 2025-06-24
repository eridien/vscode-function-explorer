import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as disp         from './display';
import {SidebarProvider} from './display';
import * as itms         from './display';
import {Item, WsAndFolderItem, FileItem, FuncItem} 
                         from './display';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');

export async function activate(context: vscode.ExtensionContext) {
  start('extension');

////////////  COMMANDS  ////////////
  
	// const toggleCmd = vscode.commands.registerCommand(
  //          'vscode-function-explorer.toggle', async () => {
	// 	await cmds.toggleCmd();
	// });

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
		disp.toggleMarkedFilter(fileItem);
	});

	const toggleMarkedFilterMenu = vscode.commands.registerCommand(
   'vscode-function-explorer.toggleMarkedFilterMenu', (fileItem: FileItem) => {
		disp.toggleMarkedFilter(fileItem);
	});

	const toggleAlphaSort = vscode.commands.registerCommand(
          'vscode-function-explorer.toggleAlphaSort', (fileItem: FileItem) => {
		disp.toggleAlphaSort(fileItem);
	});

	const toggleAlphaSortMenu = vscode.commands.registerCommand(
      'vscode-function-explorer.toggleAlphaSortMenu', (fileItem: FileItem) => {
		disp.toggleAlphaSort(fileItem);
	});

	const removeMarks = vscode.commands.registerCommand(
                      'vscode-function-explorer.removeMarks', async (item: Item) => {
		// await disp.removeMarks(item);
	});

	const removeMarksMenu = vscode.commands.registerCommand(
                  'vscode-function-explorer.removeMarksMenu', async (item: Item) => {
		// await disp.removeMarks(item);
	});

	const toggleItemMark = vscode.commands.registerCommand(
		'vscode-function-explorer.toggleItemMark', async (funcItem: FuncItem) => {
		await cmds.toggleItemMarkCmd(funcItem);
	});

	const funcClickCmd = vscode.commands.registerCommand(
            'vscode-function-explorer.funcClickCmd', (funcItem: FuncItem) => {
		cmds.funcClickCmd(funcItem);
	});

////////////  SETTINGS  ////////////

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('function-explorer')) {
      sett.loadSettings();
      // disp.setFileWatcher();
      // cmds.updateSide();
    }
  });

////////////  SIDEBAR  ////////////

  const sidebarProvider = new SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  const sidebarVisChg = treeView.onDidChangeVisibility(async (visible) => {
    if(visible) await disp.updatePointers();
  });

  const treeSelChg = treeView.onDidChangeSelection(() => {
     // item selection[]
  });

  const itemExpandChg = treeView.onDidExpandElement(async event => {
    await disp.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(async event => {
    await disp.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(
    async event => {
      if (event.textEditor?.document.uri.scheme !== 'file') return;
    await cmds.selectionChg(event);
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => {if(editor) await cmds.editorOrTextChg(editor);});

  const textChg = vscode.workspace.onDidChangeTextDocument(async event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) 
      await cmds.editorOrTextChg(editor);
  });

////////////  INIT  ////////////

  sett.loadSettings();
  disp.activate(context, treeView, sidebarProvider);
  await cmds.activate();

	context.subscriptions.push(
    // toggleCmd, 
    prev, next, funcClickCmd, loadSettings,
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