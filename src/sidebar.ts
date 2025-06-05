// @@ts-nocheck

import vscode      from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as mrks   from './marks';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils.js';
import { get } from 'http';
const {log, start, end} = utils.getLog('side');

const showPointers   = true;
let itemTree         = [];
let   treeView : vscode.TreeView<Item>;

export function init(treeViewIn: vscode.TreeView<Item>) {
  treeView = treeViewIn;
}

class Item extends vscode.TreeItem {
  wsFolder?:   vscode.WorkspaceFolder;
  mark?:       mrks.Mark;
  children?:   Item[];
}

export class SidebarProvider {
  onDidChangeTreeData:          vscode.Event<Item>;
  private _onDidChangeTreeData: vscode.EventEmitter<Item>;
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  getTreeItem(item: Item): Item {
    return item;
  }
  async getChildren(item: Item): Promise<Item[]> {
    if (showingBusy) return [];
    if(!item) {
      await mrks.waitForInit();
      return await getItemTree();
    }
    return item.children ?? [];
  }
}

let intervalId: NodeJS.Timeout | null = null;
let timeoutId:  NodeJS.Timeout | null = null;
let showingBusy = false;

export function setBusy(busy: boolean, blinking = false) {
  if (treeView) 
      treeView.message = busy ? '⟳ Processing Bookmarks ...' : '';
  utils.updateSide();
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

async function getWsFolderItem(wsFolder: vscode.WorkspaceFolder) {
  const id      = wsFolder.uri.fsPath;
  const label   = wsFolder.name;
  const item    = new Item(label, vscode.TreeItemCollapsibleState.Expanded);
  const iconPath = new vscode.ThemeIcon('root-folder');
  const entries = await fs.readdir(
                        wsFolder.uri.fsPath, { withFileTypes: true });
  let children: Item[] = [];
  for (const entry of entries) {
    if(entry.isDirectory()) {
      const folderItem = await getFolderItem(
                                 path.join(wsFolder.uri.fsPath, entry.name));
      if(folderItem === null) continue;
      children.push(folderItem);
    }
    if(entry.isFile()) {
      const fileItem = getFileItem(path.join(wsFolder.uri.fsPath, entry.name));
      if(fileItem === null) continue;
      children.push(fileItem);
    }
  }
  Object.assign(item, {id, contextValue:'wsFolder', iconPath, label, children});
  item.command = {
    command:   'vscode-function.itemClickCmd',
    title:     'Item Clicked',
    arguments: [id],
  };
  return item;
}     

async function getFolderItem(folderFsPath: string) {
  const entries = await fs.readdir(folderFsPath, {withFileTypes: true});
  const children = entries.filter(entry => {
    const fileFsPath = path.join(folderFsPath, entry.name);
    return (entry.isFile() && sett.includeFile(fileFsPath));
  }).map(entry => getFileItem(path.join(folderFsPath, entry.name))
  ).filter(item => item !== null);
  if(children.length === 0) return null;
  const folderUri = vscode.Uri.file(folderFsPath);
  const label     = folderUri.path.split('/').pop() ?? folderUri.path;
  const item      = new Item(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id         = folderFsPath;
  const iconPath  = new vscode.ThemeIcon('folder');
  Object.assign(item, {contextValue:'folder', children, iconPath});
  item.command = {
    command:   'vscode-function.itemClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

function getFileItem(fsPath: string) {
  const children = mrks.getSortedMarks({fsPath, alpha:true})
                       .map(mark => getMarkItem(mark));  
  if(children.length === 0) return null;
  const fileUri  = vscode.Uri.file(fsPath);
  const label    = fileUri.path.split('/').pop() ?? fileUri.path;
  const item     = new Item(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id        = fsPath;
  const iconPath = new vscode.ThemeIcon('file');
  Object.assign(item, {contextValue:'file', children, iconPath});
  item.command = {
    command:   'vscode-function.itemClickCmd',
    title:     'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

function getMarkItem(mark: mrks.Mark) {
  const item = new Item(mark.name, vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id: mark.id, contextValue:'mark', mark});
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor                                        && 
    activeEditor.document.uri.scheme === 'file'           &&
    mark.getFsPath() === activeEditor.document.uri.fsPath &&
    mark.getStartLine() === activeEditor.selection.active.line) 
  item.iconPath = new vscode.ThemeIcon('triangle-right');
  item.command = {
    command: 'vscode-function.itemClickCmd',
    title:   'Item Clicked',
    arguments: [item.id],
  };
  return item;
};

async function getItemTree() {
  start('getItemTree', true);
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders) {
    log('err', 'getItemTree, No folders in workspace');
    return [];
  }
  const promises = wsFolders.map(async (wsFolder) => {
    return await getWsFolderItem(wsFolder);
  });
  const rootTree = await Promise.all(promises);
  return rootTree;
}

export function itemClick(item: Item) {
  log('itemClick');
  // if(item === undefined) {
  //   item = treeView.selection[0];
  //   if (!item) { log('info err', 'No Bookmark Selected'); return; }
  // }
  // // text.clearDecoration();
  // switch(item.contextValue) {
  //   case 'folder': toggleFolder(item); break;
  //   case 'file':
  //     if(!item.mark) return;
  //     await vscode.window.showTextDocument(
  //                              item.mark.document, {preview: false});
  //     break;
  //   case 'mark': mrks.markItemClick(item); break;
  // }
}
