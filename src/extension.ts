import * as vscode       from 'vscode';
import * as cmds         from './commands';
import * as disp         from './display';
import * as sbar         from './sidebar';
import * as dbs          from './dbs';
import * as itmc         from './item-classes';
import {Item, WsAndFolderItem, FileItem, FuncItem} 
                         from './item-classes';
import * as sett         from './settings';
import * as utils        from './utils';
const {log, start, end} = utils.getLog('extn');


export async function activate(context: vscode.ExtensionContext) {
  start('extension');

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
		// log('next');
		await cmds.next();
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
      // disp.setFileWatcher();
      // cmds.updateSide();
    }
  });

////////////  SIDEBAR  ////////////

  const sidebarProvider = new sbar.SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });
  // log('createTreeView', treeView);

  const sidebarVisChg = treeView.onDidChangeVisibility(async (event) => {
    // log('sidebarVisChg');
    cmds.setSideBarVisibility(event.visible);
    if(event.visible) await disp.updatePointers();
  });

  const treeSelChg = treeView.onDidChangeSelection(() => {
    // log('treeSelChg');
     // item selection[]
  });

  const itemExpandChg = treeView.onDidExpandElement(async event => {
    // log('itemExpandChg');
    await disp.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, true);
  });

  const itemCollapseChg = treeView.onDidCollapseElement(async event => {
    // log('itemCollapseChg');
    await disp.itemExpandChg(
                   event.element as WsAndFolderItem | FileItem, false);
  });

////////////  EDITOR  ////////////

  const selectionChg = vscode.window.onDidChangeTextEditorSelection(
    async event => {
      if (event.textEditor?.document.uri.scheme !== 'file') return;
      // log('selectionChg');
      await cmds.selectionChg(event);
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => {
      if(editor) { 
        await cmds.editorOrTextChg(editor);
        // log('editorChg');
      }
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

////////////  INIT  ////////////

  await sett.loadSettings();
  await  dbs.activate(context);
        disp.activate(context);
        sbar.activate(treeView, sidebarProvider);
  await cmds.activate();

	context.subscriptions.push(
    toggleCmd, prev, next, funcClickCmd, loadSettings,
    editorChg, selectionChg, textChg, toggleItemMark,
    sidebarVisChg, treeSelChg, itemExpandChg, itemCollapseChg,
    toggleMarkedFilter, toggleAlphaSort, removeMarks,
    toggleMarkedFilterMenu, toggleAlphaSortMenu, removeMarksMenu,
    openFile, openFileMenu,
  );

  end('extension', true);
}

export function deactivate() {
  log('extension deactivated');
}