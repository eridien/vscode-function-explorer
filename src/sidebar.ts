// @@ts-nocheck

import vscode       from 'vscode';
import * as fnct    from './funcs';
import {Func}       from './funcs';
import * as sett    from './settings';
import {Item, WsAndFolderItem, FuncItem} 
                    from './sidebar-classes';
import * as utils   from './utils.js';
const {log, start, end} = utils.getLog('side');

let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;
let treeRoot:        Item[] | null = null;

let itemsById:     Map<string, Item> = new Map();

export function activate(treeViewIn: vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  updateTree();
}

export function setItemInMap(item: Item) {
  let fsPath: string;
  if(item instanceof Func) fsPath = (item as Func).getFsPath();
  else                     fsPath = item.id!;
  itemsById.set(item.id!, item);
}

let intervalId: NodeJS.Timeout | null = null;
let timeoutId:  NodeJS.Timeout | null = null;
export let showingBusy = false;

export function setBusy(busy: boolean, blinking = false) {
  if (treeView) 
      treeView.message = busy ? '⟳ Processing Bookmarks ...' : '';
  updateTree();
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

export function updateItemsFromFuncs(updatedFuncs: Func[]) {
  for (const func of updatedFuncs) new FuncItem(func);
  updateTree();
}

export function updatePointer(func: Func, hasPointer: boolean,
                              dontRefreshItems = false) {
  let item = (itemsById.get(func.id!) as FuncItem);
  if(item && item.pointer !== hasPointer) {
    item.pointer  = hasPointer;
    item.iconPath = item.pointer 
                ? new vscode.ThemeIcon('triangle-right') : undefined;
    treeView.reveal(item, {expand: true, select: true, focus: false});
    if(!dontRefreshItems) updateTree(item);
  }
}

function clearAllPointers(dontRefreshItems = false) {
  for (const item of itemsById.values()) {
    if ((item as FuncItem).pointer) {
        (item as FuncItem).pointer = false;
        (item as FuncItem).iconPath = undefined;
      if(!dontRefreshItems) updateTree(item);
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

export async function funcClickCmd(id: string) { 
  const item = itemsById.get(id) as FuncItem;
  if (item) await fnct.revealFunc(null, item.func!, true);
}

export async function fileClickCmd(path: string) { 
  const document = 
          await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  await fnct.revealFunc(document, null);
}

export function updateTree(item?: Item) {
  sidebarProvider.refresh(item);
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

  async getChildren(item: Item): Promise<Item[]> {
    if(!item) return Item.getTree();
    return item.contextValue !== 'func' 
               ? await (item as WsAndFolderItem).getChildren() : [];
  }
}
