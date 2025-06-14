// @@ts-nocheck

import vscode     from 'vscode';
import * as fnct  from './funcs';
import {Func}     from './funcs';
import {Item, WsAndFolderItem, 
        FolderItem, FileItem, FuncItem} 
                  from './items';
import * as gutt  from './gutter';
import * as utils from './utils.js';
import { updateSide } from './commands';
const {log, start, end} = utils.getLog('side');

let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

let itemsById: Map<string, Item> = new Map();
let marksOnlySet                 = new Set<string>();

export function activate(treeViewIn: vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
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
  if(item) itemsById.set(id, item);
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

export function updatePointers() {
  removeAllPointers();
  const funcs = fnct.getFuncsOverlappingSelections();
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
    funcItem.iconPath = func.marked ? new vscode.ThemeIcon('bookmark') 
                                    : undefined;
}

export async function updateAllByFunc(func: Func) {
  await fnct.saveFuncStorage();
  updateMarkByFunc(func);
  updateSide();
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

export function toggleMarkedFilter(fileItem: FileItem) {
  fileItem.filtered = !fileItem.filtered;
  updateTree();
}

export function toggleAlphaSort(fileItem: FileItem) {
  fileItem.alphaSorted = !fileItem.alphaSorted;
  updateTree();
}

export async function toggleFuncMark(funcItem: FuncItem) {
  const func = funcItem.func;
  func.marked = !func.marked;
  await updateAllByFunc(func);
}

export function removeMarks(item: Item) {
  function hasParent(item: Item, parentId: string) {
    if(item.parentId === parentId) return true;
    if(!item.parentId) return false;
    const parentItem = itemsById.get(item.parentId);
    if(!parentItem) return false;
    return hasParent(parentItem, parentId);
  }
  function removeMarks(parentItem: Item) {
    for(const funcItem of itemsById.values()) {
      if(funcItem.contextValue !== 'func') continue;
      const func = (funcItem as FuncItem).func;
      if(func.marked && hasParent(funcItem, parentItem.id!)) 
         func.marked = false;
         funcItem.iconPath = undefined;
    }
  }
  if(item.contextValue === 'func') 
    (item as FuncItem).func.marked = false;
  else removeMarks(item);
  updateTree();
}

export function updateTree() {
  sidebarProvider.refresh();
}

export function treeExpandChg() {
  gutt.updateGutter();
}

const fsPathFuncsLoaded: Set<string> = new Set();

export async function ensureFsPathIsLoaded(fsPath: string) {
  if(!fsPathFuncsLoaded.has(fsPath)) {
    fsPathFuncsLoaded.add(fsPath);
    const uri      = vscode.Uri.file(fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    await fnct.updateFuncsInFile(document);
    const funcs = fnct.getFuncs({fsPath});
    for(const func of funcs) {
      await getOrMakeItemById(func.id!, func);
      updateMarkByFunc(func);
    }
    updateSide(document);
    updatePointers();
  }
}

export async function itemExpandChg(fileItem: FileItem, expanded: boolean) {
  if(!fileItem.expanded && expanded && fileItem.contextValue === 'file') 
    await ensureFsPathIsLoaded(fileItem.id!);
  fileItem.expanded = expanded;
}

let count = 0;

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  
  refresh(): void {
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
    if(!item) return Item.getTree();
    const children = item.contextValue !== 'func' 
            ? await (item as WsAndFolderItem | FileItem).getChildren() : [];
    return children;
  }
}
