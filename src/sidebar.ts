// @@ts-nocheck

import vscode       from 'vscode';
import { Dirent }   from 'fs';
import {minimatch}  from 'minimatch';
import * as fs      from 'fs/promises';
import * as path    from 'path';
import * as fnct    from './funcs';
import * as sett    from './settings';
import {settings}   from './settings';
import {Func, Item} from './classes';
import * as utils   from './utils.js';
const {log, start, end} = utils.getLog('side');

let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;
let treeRoot:        Item[] | null = null;

let itemsById:     Map<string, Item> = new Map();
let itemsByFsPath: Map<string, Map<string, Item>> = new Map();

export async function activate(treeViewIn: vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  await setInitialTree();
}

export function setItemInMaps(item: Item): boolean {
  const oldItem = itemsById.get(item.id!);
  let fsPath: string;
  if(item instanceof Func) fsPath = (item as Func).getFsPath();
  else                     fsPath = item.id!;
  itemsById.set(item.id!, item);
  let itemMap = itemsByFsPath.get(fsPath);
  if (!itemMap) {
    itemMap = new Map<string, Item>();
    itemsByFsPath.set(fsPath, itemMap);
  }
  itemMap.set(item.id!, item);
  return !oldItem ||
         item.label            !== oldItem.label            ||
         item.collapsibleState !== oldItem.collapsibleState ||
         item.children?.length !== oldItem.children?.length ||
         item.pointer          !== oldItem.pointer;
}

let intervalId: NodeJS.Timeout | null = null;
let timeoutId:  NodeJS.Timeout | null = null;
export let showingBusy = false;

export function setBusy(busy: boolean, blinking = false) {
  if (treeView) 
      treeView.message = busy ? '⟳ Processing Bookmarks ...' : '';
  sidebarProvider.refresh();
  if(blinking) return;
  if(busy && !showingBusy) {
    showingBusy = true;
    intervalId = setInterval(() => {
      setBusy(true, true);
      timeoutId = setTimeout(() => { setBusy(false, true); }, 1000);
    }, 2000);
    setBusy(true);
  }
  if(!busy && showingBusy) {
    showingBusy = false;
    if(intervalId) clearInterval(intervalId);
    if(timeoutId)  clearTimeout(timeoutId);
    intervalId = null;
    timeoutId  = null;
    setBusy(false, true);
  }
}

async function addFolderChildren(parentFsPath: string, 
                                 folders: Item[], files: Item[]) {
  const entries = await fs.readdir(parentFsPath, { withFileTypes: true });
  for (const entry of entries) {
    const fsPath = path.join(parentFsPath, entry.name);
    if (entry.isDirectory()) {
      const uri = vscode.Uri.file(fsPath);
      if(uri.scheme !== 'file' || 
        !sett.includeFile(fsPath, true)) continue;
      const folderItem = await getFolderItem(fsPath);
      if (folderItem !== null) {
        folderItem.parentId = parentFsPath;
        folders.push(folderItem);
      }
    }
    if (entry.isFile()) {
      const uri = vscode.Uri.file(fsPath);
      if(uri.scheme !== 'file' || 
        !sett.includeFile(fsPath)) continue;
      const fileItem = getFileItem(fsPath);
      if(fileItem !== null) {
        fileItem.parentId = parentFsPath;
        files.push(fileItem);
      }
    }
  }
}

async function getWsFolderItem(wsFolder: vscode.WorkspaceFolder) {
  const id       = wsFolder.uri.fsPath;
  const label    = wsFolder.name;
  const item     = new Item(label, vscode.TreeItemCollapsibleState.Expanded);
  const iconPath = new vscode.ThemeIcon('root-folder');
  const folders:  Item[] = [];
  const files:    Item[] = [];
  await addFolderChildren(wsFolder.uri.fsPath, folders, files);
  const children = [...folders, ...files];
  Object.assign(item, {id, contextValue:'wsFolder', 
                       iconPath, label, children});
  item.command = {
    command:   'vscode-function-explorer.workspaceFolderClickCmd',
    title:     'Item Clicked',
    arguments: [id],
  };
  setItemInMaps(item);
  return item;
}

async function getFolderItem(folderFsPath: string) {
  const folders:  Item[] = [];
  const files:    Item[] = [];
  await addFolderChildren(folderFsPath, folders, files);
  const children = [...folders, ...files];
  if(children.length === 0) return null;
  const folderUri = vscode.Uri.file(folderFsPath);
  const label     = folderUri.path.split('/').pop() ?? folderUri.path;
  const item      = new Item(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.id         = folderFsPath;
  const iconPath  = new vscode.ThemeIcon('folder');
  Object.assign(item, {contextValue:'folder', children, iconPath});
  item.command = {
    command:   'vscode-function-explorer.folderClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};

function getFileItem(fsPath: string) {
  const children = fnct.getSortedFuncs(
                            {fsPath, alpha:settings.alphaSortFuncs})
                       .map(func => { 
                         const item = getFuncItem(func);
                         item.parentId! = fsPath;
                         return item;
                       });
  const fileUri  = vscode.Uri.file(fsPath);
  const label    = fileUri.path.split('/').pop() ?? fileUri.path;
  const item     = new Item(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.id        = fsPath;
  const iconPath = new vscode.ThemeIcon('file');
  Object.assign(item, {contextValue:'file', children, iconPath});
  item.command = {
    command:   'vscode-function-explorer.fileClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};

export function getFuncItem(func: Func) {
  const item = new Item(func.name, vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id: func.id, contextValue:'func', func});
  const activeEditor = vscode.window.activeTextEditor;
  item.pointer = activeEditor                                  && 
      activeEditor.document.uri.scheme === 'file'              &&
      func.getFsPath()    === activeEditor.document.uri.fsPath &&
      func.getStartLine() === activeEditor.selection.active.line;
  // if(item.pointer) item.iconPath = new vscode.ThemeIcon('triangle-right');
  item.command = {
    command: 'vscode-function-explorer.funcClickCmd',
    title:   'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};

export async function setInitialTree() {
  start('getItemTree', true);
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders) {
    log('err', 'getItemTree, No folders in workspace');
    return [];
  }
  const promises = wsFolders.map(async (wsFolder) => {
    return await getWsFolderItem(wsFolder);
  });
  treeRoot = await Promise.all(promises);
  sidebarProvider.refresh();
  end('getItemTree');
  return treeRoot;
}

export function updateItemsFromFuncs(updatedFuncs: Func[]) {
  for (const func of updatedFuncs) getFuncItem(func);
  sidebarProvider.refresh();
}

export function updatePointer(func:Func, hasPointer: boolean,
                              dontRefreshItems = false) {
  let item = itemsById.get(func.id!);
  if(item && item.pointer !== hasPointer) {
    item.pointer  = hasPointer;
    item.iconPath = item.pointer 
                ? new vscode.ThemeIcon('triangle-right') : undefined;
    treeView.reveal(item, {expand: true, select: true, focus: false});
    if(!dontRefreshItems) sidebarProvider.refresh(item);
  }
}

function clearAllPointers(dontRefreshItems = false) {
  for (const item of itemsById.values()) {
    if (item.pointer) {
      item.pointer = false;
      item.iconPath = undefined;
      if(!dontRefreshItems) sidebarProvider.refresh(item);
    }
  }
}

export function updatePointers(editor: vscode.TextEditor | null | undefined, 
                               dontRefreshItems = false) {
  editor ??= vscode.window.activeTextEditor;
  if (!editor) return;
  clearAllPointers(dontRefreshItems);
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if(document.uri.scheme !== 'file' || 
    !sett.includeFile(fsPath)) return;
  const funcs = fnct.getFuncs({fsPath});
  for(const func of funcs) {
    const funcLine = func.getStartLine();
    let hasPointer = false;
    for(const selection of editor.selections) {
      hasPointer = funcLine >= selection.start.line  && 
                   funcLine <= selection.end.line;
      if(hasPointer) break; 
    }
    updatePointer(func, hasPointer, dontRefreshItems);
  }
}

export function fileChanged(uri: vscode.Uri) {

}
export function fileCreated(uri: vscode.Uri) {

}
export function fileDeleted(uri: vscode.Uri) {

}

let focusedItem: Item | null = null;
let sideBarVisible: boolean = false;

export function chgItemFocus(selection: Item | null) {
  focusedItem = selection;
}

export function chgSidebarVisibility(visible: boolean) {
  sideBarVisible = visible;
  if(!visible) focusedItem = null;
}

export async function funcClickCmd() { 
  if (focusedItem?.func) await fnct.revealFunc(null, focusedItem.func, true);
}

export async function fileClickCmd(path: string) { 
  const document = 
          await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  await fnct.revealFunc(document, null);
}

export function updateTree() {
  sidebarProvider.refresh();
}

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  
  refresh(item?: Item): void {
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(item: Item): Item {
    return itemsById.get(item.id!) ?? item;
  }

  getParent(item: Item): Item | null {
    if(item?.parentId) {
      const parentItem = itemsById.get(item.parentId);
      if(parentItem) return parentItem;
    }
    return null;
  }

  getChildren(item: Item): Item[] {
    if(!item) return treeRoot ?? [];
    return item.children      ?? [];
  }
}
