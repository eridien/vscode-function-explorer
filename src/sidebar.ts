// @@ts-nocheck

import vscode       from 'vscode';
import { Dirent }   from 'fs';
import {minimatch}  from 'minimatch';
import * as fs      from 'fs/promises';
import * as path    from 'path';
import * as mrks    from './marks';
import * as sett    from './settings';
import {settings}   from './settings';
import {Mark, Item} from './classes';
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
  if(item instanceof Mark) fsPath = (item as Mark).getFsPath();
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
  sidebarProvider.refresh(undefined);
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

async function addFoldersAndFiles(parentFsPath: string, 
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
        // await addFoldersAndFiles(fsPath, folders, files);
      }
    }
    if (entry.isFile()) {
      const uri = vscode.Uri.file(fsPath);
      if(uri.scheme !== 'file' || 
        !sett.includeFile(fsPath)) continue;
      const fileItem = getFileItem(fsPath);
      if(fileItem !== null) files.push(fileItem);
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
  await addFoldersAndFiles(wsFolder.uri.fsPath, folders, files);
  const children = [...folders, ...files];
  Object.assign(item, {id, contextValue:'wsFolder', 
                       iconPath, label, children});
  item.command = {
    command:   'vscode-function-marks.workspaceFolderClickCmd',
    title:     'Item Clicked',
    arguments: [id],
  };
  setItemInMaps(item);
  return item;
}

async function getFolderItem(folderFsPath: string) {
  const folders:  Item[] = [];
  const files:    Item[] = [];
  await addFoldersAndFiles(folderFsPath, folders, files);
  const children = [...folders, ...files];
  if(children.length === 0) return null;
  const folderUri = vscode.Uri.file(folderFsPath);
  const label     = folderUri.path.split('/').pop() ?? folderUri.path;
  const item      = new Item(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.id         = folderFsPath;
  const iconPath  = new vscode.ThemeIcon('folder');
  Object.assign(item, {contextValue:'folder', children, iconPath});
  item.command = {
    command:   'vscode-function-marks.folderClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};

function getFileItem(fsPath: string) {
  const children = mrks.getSortedMarks(
                            {fsPath, alpha:settings.alphaSortMarks})
                       .map(mark => { 
                         const item = getMarkItem(mark);
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
    command:   'vscode-function-marks.fileClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};

export function getMarkItem(mark: Mark) {
  const item = new Item(mark.name, vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id: mark.id, contextValue:'mark', mark});
  const activeEditor = vscode.window.activeTextEditor;
  item.pointer = activeEditor                                  && 
      activeEditor.document.uri.scheme === 'file'              &&
      mark.getFsPath()    === activeEditor.document.uri.fsPath &&
      mark.getStartLine() === activeEditor.selection.active.line;
  // if(item.pointer) item.iconPath = new vscode.ThemeIcon('triangle-right');
  item.command = {
    command: 'vscode-function-marks.markClickCmd',
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
  sidebarProvider.refresh(undefined);
  end('getItemTree');
  return treeRoot;
}

export function updatePointer(mark:Mark, hasPointer: boolean) {
  let item = itemsById.get(mark.id!);
  if(item && item.pointer !== hasPointer) {
    item.pointer  = hasPointer;
    item.iconPath = item.pointer 
                ? new vscode.ThemeIcon('triangle-right') : undefined;
    if(item.pointer && treeView.visible) {
      while(item && item.parentId !== undefined) {
        if(item.contextValue !== 'mark') break;
          item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        item = itemsById.get(item!.parentId);
      }
    }
    sidebarProvider.refresh(item);
  }
}

export function chgEditorSel(event: vscode.TextEditorSelectionChangeEvent) {
  const editor   = event.textEditor;
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if(document.uri.scheme !== 'file' || 
    !sett.includeFile(fsPath)) return;
  const marks = mrks.getMarks({fsPath});
  for(const selection of event.selections) {
    for(const mark of marks) {
      const markLine = mark.getStartLine();
      const hasPointer = markLine >= selection.start.line  && 
                         markLine <= selection.end.line;
      updatePointer(mark, hasPointer);
    }
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

export async function markClickCmd() { 
  if (focusedItem?.mark) await mrks.revealMark(null, focusedItem.mark, true);
}

export async function fileClickCmd(path: string) { 
  const document = 
          await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  await mrks.revealMark(document, null);
}

export function refreshItems(items: Item[] | undefined) {
  if (items) {
    for (const item of items) sidebarProvider.refresh(item);
    return;
  }
  sidebarProvider.refresh(undefined);
}

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  
  refresh(item: Item | undefined): void {
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(item: Item): Item {
    return itemsById.get(item.id!) ?? item;
  }

  getChildren(item: Item): Item[] {
    if(!item) return treeRoot ?? [];
    return item.children      ?? [];
  }
}
