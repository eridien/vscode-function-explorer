// @@ts-nocheck

import vscode     from 'vscode';
import * as fs    from 'fs/promises';
import * as path  from 'path';
import * as fnct  from './funcs';
import {Func}     from './funcs';
import * as itms  from './items';
import {Item, WsAndFolderItem, 
        FolderItem, FileItem, FuncItem} from './items';
import * as sett  from './settings';
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

export async function revealItemByFunc(func: Func) {
  if(!treeView.visible) return;
  const item = await getOrMakeItemById(func.id, func);
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

function removeAllPointers() {
  for(const item of itemsById.values()) {
    if(item.contextValue == 'func') {
      const funcItem = item as FuncItem;
      const func = fnct.getFuncById(funcItem.id);
      if(!func) continue;
      funcItem.label = itms.getFuncItemLabel(func);
    }
  }
}

export async function setPointer(func: Func) {
  const funcItem = itemsById.get(func.id);
  if(funcItem) {
    funcItem.label = `➤ ${itms.getFuncItemLabel(func)}`;
    await revealItemByFunc(func);
  }
}

export async function updatePointers() : Promise<boolean>{
  removeAllPointers();
  const funcs = fnct.getFuncsOverlappingSelections();
  for(const func of funcs) await setPointer(func);
  updateTree();
  return funcs.length > 0;
}

export function updateMarkIconByFunc(func: Func) {
  const funcItem = itemsById.get(func.id);
  if(funcItem) 
    funcItem.iconPath = func.marked ? new vscode.ThemeIcon('bookmark') 
                                    : undefined;
}

export async function saveFuncAndUpdate(func: Func) {
  await fnct.saveFuncStorage();
  updateMarkIconByFunc(func);
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
  const func = item ? fnct.getFuncById(id) : null;
  if (item) await fnct.revealFunc(null, func!);
}

export function toggleMarkedFilter(fileItem: FileItem) {
  fileItem.filtered = !fileItem.filtered;
  updateTree();
}

export function toggleAlphaSort(fileItem: FileItem) {
  fileItem.alphaSorted = !fileItem.alphaSorted;
  updateTree();
}

export async function hasChildFuncTest(fsPath: string): Promise<boolean> {
  let stat;
  try { stat = await fs.stat(fsPath);
  } catch { return false; }
  if (stat.isDirectory()) {
    let entries: string[];
    try { entries = await fs.readdir(fsPath); } 
    catch { return false; }
    for (const entry of entries) {
      const childPath = path.join(fsPath, entry);
      if (await hasChildFuncTest(childPath)) return true;
    }
  }
  else if(sett.includeFile(fsPath, false)) return true;
  return false;
}

export async function removeMarks(item: Item) {
  function hasParent(item: Item, parentId: string) {
    if(item.parentId === parentId) return true;
    if(!item.parentId) return false;
    const parentItem = itemsById.get(item.parentId);
    if(!parentItem) return false;
    return hasParent(parentItem, parentId);
  }
  if(item.contextValue === 'func') {
    const func = fnct.getFuncById((item as FuncItem).id!);
    if(func) {
      func.marked = false;
      updateMarkIconByFunc(func);
    }
  }
  else {
    const funcs = fnct.getFuncs({});
    for(const func of funcs) {
      const funcItem = await getOrMakeItemById(func.id, func);
      if(hasParent(funcItem, item.id!)) {
        func.marked = false;
        updateMarkIconByFunc(func);
      }
    }
  }
  await fnct.saveFuncStorage();
  updateSide();
}

export function updateTree() {
  sidebarProvider.refresh();
}

export function treeExpandChg() {
  gutt.updateGutter();
}

const fileItemsLoaded: Set<string> = new Set();

export async function ensureFileItemsLoaded(fsPath: string) {
  if(!fileItemsLoaded.has(fsPath)) {
    fileItemsLoaded.add(fsPath);
    const uri      = vscode.Uri.file(fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    await fnct.updateFuncsInFile(document);
    const funcs = fnct.getFuncs({fsPath});
    for(const func of funcs) {
      const funcItem = await getOrMakeItemById(func.id, func);
      funcItem.parentId = fsPath;
      updateMarkIconByFunc(func);
    }
    updateSide(document);
    await updatePointers();
  }
}

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!item.expanded && expanded && item.contextValue === 'file') {
    await ensureFileItemsLoaded(item.id!);
    await utils.revealEditorByFspath(item.id!);
  }
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
