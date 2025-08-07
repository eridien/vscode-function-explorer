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
import {extStatus}       from './utils';
const {log, start, end} = utils.getLog('extn');

export async function activate(context: vscode.ExtensionContext) {
  start('activate');

////////////  INIT  ////////////

  const sidebarProvider = new sbar.SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

       utils.activate(context, sidebarProvider);
         dbs.activate(context);
  await sett.loadSettings();
  await pars.activate(context);
        disp.activate(context, treeView);
        sbar.activate(treeView, sidebarProvider);
        itmc.activate(treeView);
  await cmds.activate(treeView);

////////////  COMMANDS  ////////////
  
	const toggleCmd = vscode.commands.registerCommand(
           'vscode-function-explorer.toggle', async (x:any) => {
    // log('toggleCmd');
    if(extStatus.isAborted()) return;
		await cmds.toggleCmd();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-explorer.prev', async () => {
    // log('prev');
    if(extStatus.isAborted()) return;
		await cmds.prevNext(false);
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-explorer.next', async () => {
    if(extStatus.isAborted()) return;
		await cmds.prevNext(true);
	});

	const prevFunction = vscode.commands.registerCommand(
                   'vscode-function-explorer.prevFunction', async () => {
    // log('prev');
    if(extStatus.isAborted()) return;
		await cmds.prevNext(false, true);
	});

	const nextFunction = vscode.commands.registerCommand(
                   'vscode-function-explorer.nextFunction', async () => {
    if(extStatus.isAborted()) return;
		await cmds.prevNext(true, true);
	});

	const showNodes = vscode.commands.registerCommand(
                   'vscode-function-explorer.showNodes', async () => {
    if(extStatus.isAborted()) return;
		await cmds.showNodeHighlightsCmd();
	});

	const removeAllMarksMenu = vscode.commands.registerCommand(
       'vscode-function-explorer.removeAllMarksMenu', async () => {
    if(extStatus.isAborted()) return;
		await cmds.removeAllMarksMenu();
	});

	const collapseAllItems = vscode.commands.registerCommand(
       'vscode-function-explorer.collapseAllItems', () => {
      //  log('collapseAllItems');
    if(extStatus.isAborted()) return;
		cmds.collapseAllItems();
	});

	const showOnlyMarks = vscode.commands.registerCommand(
       'vscode-function-explorer.showOnlyMarks', async () => {
      //  log('showOnlyMarks');
    if(extStatus.isAborted()) return;
		await cmds.showOnlyMarks();
	});

	const refresh = vscode.commands.registerCommand(
       'vscode-function-explorer.refresh', () => {
      //  log('refresh');
    if(extStatus.isAborted()) return;
		cmds.refresh();
	});

	const showFolders = vscode.commands.registerCommand(
       'vscode-function-explorer.showFolders', async () => {
      //  log('showFolders');
    if(extStatus.isAborted()) return;
		await cmds.showFolders();
	});

	const hideFolders = vscode.commands.registerCommand(
       'vscode-function-explorer.hideFolders', async () => {
      //  log('hideFolders');
    if(extStatus.isAborted()) return;
		await cmds.hideFolders();
	});

	const openEditorsAsPinned = vscode.commands.registerCommand(
       'vscode-function-explorer.openEditorsAsPinned', async () => {
      //  log('openEditorsAsPinned');
    if(extStatus.isAborted()) return;
		await cmds.openEditorsAsPinned();
	});

	const openEditorsAsPreview = vscode.commands.registerCommand(
       'vscode-function-explorer.openEditorsAsPreview', async () => {
      //  log('openEditorsAsPreview');
    if(extStatus.isAborted()) return;
		await cmds.openEditorsAsPreview();
	});

	const settingsMenu = vscode.commands.registerCommand(
       'vscode-function-explorer.settingsMenu', async () => {
      //  log('settingsMenu');
    if(extStatus.isAborted()) return;
		await cmds.settingsMenu();
	});

	const toggleMarkedFilter = vscode.commands.registerCommand(
       'vscode-function-explorer.toggleMarkedFilter', (fileItem: FileItem) => {
      //  log('toggleMarkedFilter');
    if(extStatus.isAborted()) return;
		itmc.toggleMarkedFilter(fileItem);
	});

	const toggleMarkedFilterMenu = vscode.commands.registerCommand(
   'vscode-function-explorer.toggleMarkedFilterMenu', (fileItem: FileItem) => {
		// log('toggleMarkedFilterMenu');
    if(extStatus.isAborted()) return;
		itmc.toggleMarkedFilter(fileItem);
	});

	const toggleAlphaSort = vscode.commands.registerCommand(
          'vscode-function-explorer.toggleAlphaSort', (fileItem: FileItem) => {
          // log('toggleAlphaSort');
    if(extStatus.isAborted()) return;
		itmc.toggleAlphaSort(fileItem);
	});

	const toggleAlphaSortMenu = vscode.commands.registerCommand(
      'vscode-function-explorer.toggleAlphaSortMenu', (fileItem: FileItem) => {
		// log('toggleAlphaSortMenu');
    if(extStatus.isAborted()) return;
		itmc.toggleAlphaSort(fileItem);
	});

	const removeMarks = vscode.commands.registerCommand(
                'vscode-function-explorer.removeMarks', async (item: Item) => {
                // log('removeMarks');
    if(extStatus.isAborted()) return;
		await cmds.removeMarks(item);
	});

	const removeMarksMenu = vscode.commands.registerCommand(
            'vscode-function-explorer.removeMarksMenu', async (item: Item) => {
		// log('removeMarksMenu');
    if(extStatus.isAborted()) return;
		await cmds.removeMarks(item);
	});

	const openFile = vscode.commands.registerCommand(
                'vscode-function-explorer.openFile', async (item: Item) => {
                // log('openFile');
    if(extStatus.isAborted()) return;
		await cmds.openFile(item);
	});

	const openFileMenu = vscode.commands.registerCommand(
            'vscode-function-explorer.openFileMenu', async (item: Item) => {
		// log('openFileMenu');
    if(extStatus.isAborted()) return;
		 await cmds.openFile(item);
	});

	const toggleItemMark = vscode.commands.registerCommand(
		'vscode-function-explorer.toggleItemMark', async (funcItem: FuncItem) => {
	  // log('toggleItemMark');
    if(extStatus.isAborted()) return;
  	await cmds.toggleItemMarkCmd(funcItem);
	});

	const toggleItemMarkMenu = vscode.commands.registerCommand(
		'vscode-function-explorer.toggleItemMarkMenu', async (funcItem: FuncItem) => {
	  // log('toggleItemMarkMenu');
    if(extStatus.isAborted()) return;
  	await cmds.toggleItemMarkCmd(funcItem);
	});

	const funcClickCmd = vscode.commands.registerCommand(
       'vscode-function-explorer.funcClickCmd', async (funcItem: FuncItem) => {
    // log('funcClickCmd');
    if(extStatus.isAborted()) return;
    await cmds.funcClickCmd(funcItem);
	});

////////////  SETTINGS  ////////////

  const loadSettings = vscode.workspace
                             .onDidChangeConfiguration(async event => {
    if(extStatus.isAborted()) return;
    if (event.affectsConfiguration('function-explorer')) {
      await sett.loadSettings();
      await sbar.refreshTree();
    }
  });

////////////  SIDEBAR  ////////////

  // log('createTreeView', treeView);

  const treeSelChg = treeView.onDidChangeSelection(() => {
    if(extStatus.isAborted()) return;
    // log('treeSelChg');
  });

  const itemExpandChg = treeView.onDidExpandElement(async event => {
    // log('itemExpandChg');
    if(extStatus.isAborted()) return;
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(async event => {
    // log('itemCollapseChg');
    if(extStatus.isAborted()) return;
    await sbar.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(
    async event => {
      if(extStatus.isAborted()) return;
      if (event.textEditor?.document.uri.scheme !== 'file') return;
      await cmds.selectionChg(event);
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => {
      if (extStatus.isAborted()) return;
      if (editor) await cmds.editorOrTextChg(editor);
    });

  const textChg = vscode.workspace.onDidChangeTextDocument(
    async event => {
      // log('textChg');
      if(extStatus.isAborted()) return;
      const {document} = event;
      for(const editor of vscode.window.visibleTextEditors
                      .filter(editor => editor.document === document)) {
        await cmds.editorOrTextChg(editor);
      }
  });

  extStatus.setDisposables([
      toggleCmd, prev, next, prevFunction, nextFunction, funcClickCmd,
      editorChg, selectionChg, textChg, toggleItemMark, toggleItemMarkMenu,
      treeSelChg, itemExpandChg, itemCollapseChg, loadSettings,
      toggleMarkedFilter, toggleAlphaSort, removeMarks,
      toggleMarkedFilterMenu, toggleAlphaSortMenu, removeMarksMenu,
      openFile, openFileMenu, settingsMenu, removeAllMarksMenu, 
      collapseAllItems, showFolders, hideFolders, refresh,
      showNodes, showOnlyMarks, openEditorsAsPinned, openEditorsAsPreview
    ]
  );

  end('activate');
}

// export function deactivate() {
//   log('extension deactivated');
// }