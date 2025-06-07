// @@ts-nocheck

import vscode      from 'vscode';
import { Dirent }  from 'fs';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as mrks   from './marks';
import * as sett   from './settings';
import {settings}  from './settings';
import {Mark, Item, SidebarProvider, setRootTree} 
                   from './classes';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('side');

let treeView       : vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;
let rootTree       : Item[] | null = null;

export function activate(treeViewIn: vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
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

async function addFolderOrFile(entry:  Dirent, fsPath: string, 
                               folders: Item[], files: Item[]) {
  if (entry.isDirectory()) {
    const folderItem = await getFolderItem(fsPath);
    if (folderItem !== null) folders.push(folderItem);
  }
  if (entry.isFile()) {
    const uri = vscode.Uri.file(fsPath);
    if(uri.scheme !== 'file' || 
      !sett.includeFile(fsPath)) return;
    const fileItem = getFileItem(fsPath);
    if(fileItem !== null) files.push(fileItem);
  }
}

async function getWsFolderItem(wsFolder: vscode.WorkspaceFolder) {
  const id       = wsFolder.uri.fsPath;
  const label    = wsFolder.name;
  const item     = new Item(label, vscode.TreeItemCollapsibleState.Expanded);
  const iconPath = new vscode.ThemeIcon('root-folder');
  const folders:  Item[] = [];
  const files:    Item[] = [];
  const entries = await fs.readdir(
                        wsFolder.uri.fsPath, { withFileTypes: true });
  for (const entry of entries) {
    const fsPath = path.join(wsFolder.uri.fsPath, entry.name);
    await addFolderOrFile(entry, fsPath, folders, files);
  }
  const children = [...folders, ...files];
  Object.assign(item, {id, contextValue:'wsFolder', 
                       iconPath, label, children});
  item.command = {
    command:   'vscode-function.workspaceFolderClickCmd',
    title:     'Item Clicked',
    arguments: [id],
  };
  return item;
}     

async function getFolderItem(folderFsPath: string) {
  const folders:  Item[] = [];
  const files:    Item[] = [];
  const entries = await fs.readdir(folderFsPath, {withFileTypes: true});
  for (const entry of entries) {
    const fsPath = path.join(folderFsPath, entry.name);
    await addFolderOrFile(entry, fsPath, folders, files);
  }
  const children = [...folders, ...files];
  if(children.length === 0) return null;
  const folderUri = vscode.Uri.file(folderFsPath);
  const label     = folderUri.path.split('/').pop() ?? folderUri.path;
  const item      = new Item(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.id         = folderFsPath;
  const iconPath  = new vscode.ThemeIcon('folder');
  Object.assign(item, {contextValue:'folder', children, iconPath});
  item.command = {
    command:   'vscode-function.folderClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

function getFileItem(fsPath: string) {
  const children = mrks.getSortedMarks(
                            {fsPath, alpha:settings.alphaSortMarks})
                      .map(mark => getMarkItem(mark));  
  const fileUri  = vscode.Uri.file(fsPath);
  const label    = fileUri.path.split('/').pop() ?? fileUri.path;
  const item     = new Item(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.id        = fsPath;
  const iconPath = new vscode.ThemeIcon('file');
  Object.assign(item, {contextValue:'file', children, iconPath});
  item.command = {
    command:   'vscode-function.fileClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

export function getMarkItem(mark: Mark) {
  const item = new Item(mark.name, vscode.TreeItemCollapsibleState.None);
  mark.item = item;
  Object.assign(item, {id: mark.id, contextValue:'mark', mark});
  const activeEditor = vscode.window.activeTextEditor;
  item.pointer = activeEditor                                  && 
      activeEditor.document.uri.scheme === 'file'              &&
      mark.getFsPath()    === activeEditor.document.uri.fsPath &&
      mark.getStartLine() === activeEditor.selection.active.line;
  if(item.pointer) item.iconPath = new vscode.ThemeIcon('triangle-right');
  item.command = {
    command: 'vscode-function-marks.markClickCmd',
    title:   'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

export async function getItemTree() {
  start('getItemTree', true);
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders) {
    log('err', 'getItemTree, No folders in workspace');
    return [];
  }
  const promises = wsFolders.map(async (wsFolder) => {
    return await getWsFolderItem(wsFolder);
  });
  rootTree = await Promise.all(promises);
  setRootTree(rootTree);
  end('getItemTree');
  return rootTree;
}

export function updatePointer(mark:Mark, match: boolean) {
  let firstItemExpanded:Item | null = null;
  function walk(item: Item, mark: Mark, match: boolean, expand = false) {
    if (expand) { 
      if(!firstItemExpanded &&
          item.collapsibleState !== vscode.TreeItemCollapsibleState.Expanded) {
        firstItemExpanded = item;
      }
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    }
    else {
      if (item.id === mark.id) { 
        if(item.pointer !== match) {
          item.pointer  = !item.pointer;
          item.iconPath =  item.pointer 
                ? new vscode.ThemeIcon('triangle-right') : undefined;
          if(sideBarVisible) {
            for (const item of rootTree ?? [])
              walk(item, mark, true, true);
            if(firstItemExpanded)
              sidebarProvider.refresh(firstItemExpanded);
            return;
          }
        }
        sidebarProvider.refresh(item);
      }
    }
    for (const child of item.children ?? []) {
      walk(child, mark, match, expand);
    }
  }
  for (const item of rootTree ?? [])
    walk(item, mark, match);
}

export function chgEditorSel(event: vscode.TextEditorSelectionChangeEvent) {
  const editor   = event.textEditor;
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if(document.uri.scheme !== 'file' || 
    !sett.includeFile(fsPath)) return;
  const marks = mrks.getMarks({fsPath});
  for(const mark of marks) {
    if(mark.item?.pointer) {
      mark.item.pointer = undefined;
      break;
    }
  }

  findLoop:
  for(const selection of event.selections) {
  }
  for(const selection of event.selections) {
    for(const mark of marks) {
      const markLine = mark.getStartLine();
      const match = markLine >= selection.start.line  && 
                    markLine <= selection.end.line;
      updatePointer(mark, match);
      // if(match) continue selLoop;
    }
  }
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
  if (focusedItem?.mark) await mrks.revealMark(focusedItem.mark, true);
}

export function refreshItems(items: Item[] | undefined) {
  if (items) {
    for (const item of items) sidebarProvider.refresh(item);
    return;
  }
  sidebarProvider.refresh(undefined);
}