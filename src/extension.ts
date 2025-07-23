import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as disp         from './display';
import * as sbar         from './sidebar';
import * as dbs          from './dbs';
import * as pars         from './parse';
import * as itmc         from './item-classes';
import {Item, WsAndFolderItem, FileItem, FuncItem} 
                         from './item-classes';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');


export async function activate(context: vscode.ExtensionContext) {
  start('activate');

////////////  INIT  ////////////

  const sidebarProvider = new sbar.SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  await sett.loadSettings();
  await pars.activate(context);
        disp.activate(context, treeView);
         dbs.activate(context);
        sbar.activate(treeView, sidebarProvider);
        itmc.activate(treeView);
  await cmds.activate(treeView);


////////////  COMMANDS  ////////////
  
	const toggleCmd = vscode.commands.registerCommand(
           'vscode-function-explorer.toggle', async (x:any) => {
    // log('toggleCmd');
		await cmds.toggleCmd();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-explorer.prev', async () => {
    // log('prev');
		await cmds.prev();
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-explorer.next', async () => {
		await cmds.next();
	});

	const showNodes = vscode.commands.registerCommand(
                   'vscode-function-explorer.showNodes', async () => {
		await cmds.showNodeHighlightsCmd();
	});

	const removeAllMarksMenu = vscode.commands.registerCommand(
       'vscode-function-explorer.removeAllMarksMenu', async () => {
		await cmds.removeAllMarksMenu();
	});

	const collapseAllItems = vscode.commands.registerCommand(
       'vscode-function-explorer.collapseAllItems', () => {
      //  log('collapseAllItems');
		cmds.collapseAllItems();
	});

	const showOnlyMarks = vscode.commands.registerCommand(
       'vscode-function-explorer.showOnlyMarks', async () => {
      //  log('showOnlyMarks');
		await cmds.showOnlyMarks();
	});

	const refresh = vscode.commands.registerCommand(
       'vscode-function-explorer.refresh', async () => {
      //  log('refresh');
		await cmds.refresh();
	});

	const showFolders = vscode.commands.registerCommand(
       'vscode-function-explorer.showFolders', async () => {
      //  log('showFolders');
		await cmds.showFolders();
	});

	const hideFolders = vscode.commands.registerCommand(
       'vscode-function-explorer.hideFolders', async () => {
      //  log('hideFolders');
		await cmds.hideFolders();
	});

	const openEditorsAsPinned = vscode.commands.registerCommand(
       'vscode-function-explorer.openEditorsAsPinned', async () => {
      //  log('openEditorsAsPinned');
		await cmds.openEditorsAsPinned();
	});

	const openEditorsAsPreview = vscode.commands.registerCommand(
       'vscode-function-explorer.openEditorsAsPreview', async () => {
      //  log('openEditorsAsPreview');
		await cmds.openEditorsAsPreview();
	});

	const settingsMenu = vscode.commands.registerCommand(
       'vscode-function-explorer.settingsMenu', async () => {
      //  log('settingsMenu');
		await cmds.settingsMenu();
	});

	const toggleMarkedFilter = vscode.commands.registerCommand(
       'vscode-function-explorer.toggleMarkedFilter', (fileItem: FileItem) => {
      //  log('toggleMarkedFilter');
		itmc.toggleMarkedFilter(fileItem);
	});

	const toggleMarkedFilterMenu = vscode.commands.registerCommand(
   'vscode-function-explorer.toggleMarkedFilterMenu', (fileItem: FileItem) => {
		// log('toggleMarkedFilterMenu');
		itmc.toggleMarkedFilter(fileItem);
	});

	const toggleAlphaSort = vscode.commands.registerCommand(
          'vscode-function-explorer.toggleAlphaSort', (fileItem: FileItem) => {
          // log('toggleAlphaSort');
		itmc.toggleAlphaSort(fileItem);
	});

	const toggleAlphaSortMenu = vscode.commands.registerCommand(
      'vscode-function-explorer.toggleAlphaSortMenu', (fileItem: FileItem) => {
		// log('toggleAlphaSortMenu');
		itmc.toggleAlphaSort(fileItem);
	});

	const removeMarks = vscode.commands.registerCommand(
                'vscode-function-explorer.removeMarks', async (item: Item) => {
                // log('removeMarks');
		await cmds.removeMarks(item);
	});

	const removeMarksMenu = vscode.commands.registerCommand(
            'vscode-function-explorer.removeMarksMenu', async (item: Item) => {
		// log('removeMarksMenu');
		await cmds.removeMarks(item);
	});

	const openFile = vscode.commands.registerCommand(
                'vscode-function-explorer.openFile', async (item: Item) => {
                // log('openFile');
		await cmds.openFile(item);
	});

	const openFileMenu = vscode.commands.registerCommand(
            'vscode-function-explorer.openFileMenu', async (item: Item) => {
		// log('openFileMenu');
		 await cmds.openFile(item);
	});

	const toggleItemMark = vscode.commands.registerCommand(
		'vscode-function-explorer.toggleItemMark', async (funcItem: FuncItem) => {
	  // log('toggleItemMark');
  	await cmds.toggleItemMarkCmd(funcItem);
	});

	const funcClickCmd = vscode.commands.registerCommand(
       'vscode-function-explorer.funcClickCmd', async (funcItem: FuncItem) => {
    // log('funcClickCmd');
    await cmds.funcClickCmd(funcItem);
	});

////////////  SETTINGS  ////////////

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(async event => {
    if (event.affectsConfiguration('function-explorer')) {
      await sett.loadSettings();
      await sbar.refreshTree();
    }
  });

////////////  SIDEBAR  ////////////

  // log('createTreeView', treeView);

  const treeSelChg = treeView.onDidChangeSelection(() => {
    // log('treeSelChg');
  });

  const itemExpandChg = treeView.onDidExpandElement(async event => {
    // log('itemExpandChg');
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(async event => {
    // log('itemCollapseChg');
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(
    async event => {
      if (event.textEditor?.document.uri.scheme !== 'file') return;
      await cmds.selectionChg(event);
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => {
      if (editor) await cmds.editorOrTextChg(editor);
    });

  const textChg = vscode.workspace.onDidChangeTextDocument(
    async event => {
      // log('textChg');
      const {document} = event;
    for(const editor of vscode.window.visibleTextEditors
                    .filter(editor => editor.document === document)) {
      await cmds.editorOrTextChg(editor);
    }
  });

	context.subscriptions.push(
    toggleCmd, prev, next, funcClickCmd, loadSettings,
    editorChg, selectionChg, textChg, toggleItemMark,
    treeSelChg, itemExpandChg, itemCollapseChg,
    toggleMarkedFilter, toggleAlphaSort, removeMarks,
    toggleMarkedFilterMenu, toggleAlphaSortMenu, removeMarksMenu,
    openFile, openFileMenu, settingsMenu, removeAllMarksMenu, 
    collapseAllItems, showFolders, hideFolders, refresh,
    showNodes, showOnlyMarks, openEditorsAsPinned, openEditorsAsPreview
  );

  end('activate');
}

export function deactivate() {
  log('extension deactivated');
}