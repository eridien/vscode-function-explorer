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

export function updatePointers(editor?: vscode.TextEditor) {
  editor ??= vscode.window.activeTextEditor;
  if (!editor) return;
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
    func.pointer = hasPointer;
  }
  updateFileItem(fsPath);
}

export function fileChanged(uri: vscode.Uri) {

}
export function fileCreated(uri: vscode.Uri) {

}
export function fileDeleted(uri: vscode.Uri) {
}

export async function funcClickCmd(id: string) { 
  const item = itemsById.get(id) as FuncItem;
  if (item) await fnct.revealFunc(null, item.func!, true);
}

export async function fileClickCmd(fsPath: string) { 
  const document = 
          await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
  await fnct.revealFunc(document, null);
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
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(item: Item): Item {
    log(++count, 'getTreeItem', item.label);
    return item;
  }

  getParent(item: Item): Item | null {
    if(item?.parentId) {
      const parentItem = itemsById.get(item.parentId);
      if(parentItem) return parentItem;
    }
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
    log(++count, 'getChildren',item?.label);
    if(!item) return Item.getTree();
    const children = item.contextValue !== 'func' 
               ? await (item as WsAndFolderItem).getChildren() : [];
    return children;
  }
}
