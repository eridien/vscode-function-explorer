// @@ts-nocheck

import vscode     from 'vscode';
import path       from 'path';
import * as fnct  from './funcs';
import {Func}     from './funcs';
import {Item, WsAndFolderItem, WsFolderItem, 
        FolderItem, FileItem, FuncItem} 
                  from './items';
import * as gutt  from './gutter';
import * as utils from './utils.js';
const {log, start, end} = utils.getLog('side');

// const LOAD_ITEMS_ON_START = true;
const LOAD_ITEMS_ON_START = false;

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

export async function getOrMakeItemById(id: string, itemType: string | Func) {
  let item = itemsById.get(id);
  if(item) return item;
  if(itemType instanceof Func) {
    item = new FuncItem(itemType);
  } 
  else {
    switch (itemType) {
      case 'folder': 
            item = (await FolderItem.create(id)) as FolderItem; break;
      case 'file':   
            item = new FileItem(id); break;
      default:
        throw new Error(`getOrMakeItemById, Unknown item type: ${itemType}`);
    }
  }
  return item;
}

export function revealItem(item: Item) {
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

function removeAllPointers() {
  for(const item of itemsById.values()) {
    if(item.contextValue == 'func') {
      const funcItem = item as FuncItem;
      const func     = funcItem.func;
      funcItem.label = func.name;
    }
  }
}

export async function updatePointers() {
  removeAllPointers();
  const funcs = await fnct.getFuncsOverlappingSelections();
  for(const func of funcs) {
    const funcItem = itemsById.get(func.id!);
    if(!funcItem) continue;
    funcItem.label = `➤ ${func.name}`; 
  }
  updateTree();
}

export function updateMarkByFunc(func: Func) {
  const funcItem = itemsById.get(func.id!);
  if(funcItem) 
    funcItem.iconPath = func.marked ? new vscode.ThemeIcon('bookmark') : undefined;
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

export function treeExpandChg(item: Item, expanded: boolean) {
  gutt.updateGutter();
}

export function itemExpandChg(item: WsFolderItem | FolderItem | FileItem, 
                              expanded: boolean) {
  item.expanded = expanded;
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
            ? await (item as WsAndFolderItem | FileItem).getChildren() : [];
    return children;
  }
}
