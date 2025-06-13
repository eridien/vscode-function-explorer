// @@ts-nocheck

import vscode     from 'vscode';
import path       from 'path';
import * as fnct  from './funcs';
import {Func}     from './funcs';
import * as sett  from './settings';
import {Item, WsAndFolderItem, WsFolderItem, 
        FolderItem, FileItem, FuncItem} 
                  from './items';
import * as utils from './utils.js';
const {log, start, end} = utils.getLog('side');

let context:         vscode.ExtensionContext;
let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

let itemsById: Map<string, Item> = new Map();
let marksOnlySet                 = new Set<string>();

export function activate(treeViewIn: vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider,
                         contextIn: vscode.ExtensionContext) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  context         = contextIn;
}

export function setItemInMap(item: Item) {
  itemsById.set(item.id!, item);
}

export function revealItem(item: Item) {
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

export async function updatePointers() {
  fnct.removeAllPointers();
  const funcs = await fnct.getFuncsOverlappingSelections();
  for(const func of funcs) func.pointer = true;
  updateTree();
}

export function fileChanged(uri: vscode.Uri) {

}
export function fileCreated(uri: vscode.Uri) {

}
export function fileDeleted(uri: vscode.Uri) {
}

export function isMarksOnly(fsPath: string): boolean {
  return marksOnlySet.has(fsPath);
}

export function fileClickCmd(fsPath: string) { 
  log('fileClickCmd', fsPath);
  if(marksOnlySet.has(fsPath))
     marksOnlySet.delete(fsPath);
  else 
     marksOnlySet.add(fsPath);
  updateTree();
}

export async function funcClickCmd(id: string) { 
  const item = itemsById.get(id) as FuncItem;
  if (item) await fnct.revealFunc(null, item.func!, true);
}

export function updateTree(item?: Item) {
  sidebarProvider.refresh(item);
}

export function updateWsFolderItem(fsPath: string) {
  const oldWsFolderItem = itemsById.get(fsPath) as WsFolderItem;
  const wsFolderItem    = new WsFolderItem(oldWsFolderItem.wsFolder);
  itemsById.set(wsFolderItem.id!, wsFolderItem);
  updateTree(wsFolderItem);
}

export async function updateWsAndFolderItem(fsPath: string) {
  const oldItem = itemsById.get(fsPath) as WsAndFolderItem;
  if(oldItem && oldItem instanceof WsFolderItem) {
    updateWsFolderItem(oldItem.id!);
    return;
  }
  let folderItem = await FolderItem.create(fsPath);
  if(!folderItem) {
    folderItem = itemsById.get(fsPath) as WsAndFolderItem;
    itemsById.delete(fsPath);
    if(folderItem && folderItem.parentId)
      await updateWsAndFolderItem(folderItem.parentId);
    return;
  }
  itemsById.set(folderItem.id!, folderItem);
  updateTree(folderItem);
}

export function updateFileItem(fsPath: string) {
  const fileItem = new FileItem(fsPath);
  itemsById.set(fileItem.id!, fileItem);
  updateTree(fileItem);
}

export function updateFuncItem(func: Func) {
  const funcItem = new FuncItem(func);
  itemsById.set(funcItem.id!, funcItem);
  updateTree(funcItem);
}

let count = 0;

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  
  refresh(item?: Item): void {
    // log(++count, 'refresh', item?.label || 'undefined');
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(item: Item): Item {
    // log(++count, 'getTreeItem', item.label);
    return item;
  }

  getParent(item: Item): Item | null {
    // log(++count, 'getParent', item?.label || 'undefined');
    if(item?.parentId) {
      const parentItem = itemsById.get(item.parentId);
      if(parentItem) return parentItem;
    }
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
    log(++count, 'provider getChildren', item?.label || 'undefined');
    if(!item) return Item.getTree();
    const children = item.contextValue !== 'func' 
               ? await (item as WsAndFolderItem).getChildren() : [];
    return children;
  }
}
