import * as vscode from 'vscode';
import * as itmc   from './item-classes';
import {Item, WsAndFolderItem,
        FileItem, FuncItem} from './item-classes';
import {itms, mrks}         from './dbs';
import {settings}           from './settings';
import * as utils           from './utils';
const {log, start, end} = utils.getLog('sbar');

let treeView:  vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

export function activate(treeViewIn: vscode.TreeView<Item>,
                        sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
}

////////////////////// getTree //////////////////////

export async function getTree() {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (!settings.hideRootFolders) {
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) {
      // await fils.loadPaths(wsFolder.uri.fsPath);
      const wsFolderItem = await itmc.getOrMakeWsFolderItem(wsFolder);
      tree.push(wsFolderItem);
    }
    return tree;
  }
  const foldersIn: Item[] = [];
  const filesIn:   Item[] = [];
  for(const wsFolder of wsFolders){
    // await fils.loadPaths(wsFolder.uri.fsPath);
    const wsFolderItem = await itmc.getOrMakeWsFolderItem(wsFolder);
    await itmc.getFolderChildren(wsFolderItem, foldersIn, filesIn, true);
  }
  return [...foldersIn, ...filesIn];
}

///////////////////////////// sidebarProvider /////////////////////////////

let ignoreItemRefreshCalls = true;
let delayItemRefreshCalls  = false;
const refreshQueue: Item[] = [];
let refreshTimeout: NodeJS.Timeout | undefined;

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }

  refresh(item:Item | undefined, tryAgain = false): void {
    if(ignoreItemRefreshCalls) return;
    if(delayItemRefreshCalls) {
      if(!tryAgain) refreshQueue.push(item!);
      clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {this.refresh(item, true);}, 10);
      return;
    }
    for(const queueItem of refreshQueue) {
      // log('refresh1', item?.label, item?.id);
      this._onDidChangeTreeData.fire(queueItem);
    }
    refreshQueue.length = 0;
    // log('refresh2', item?.label, item?.id);
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(itemIn: Item): Item {
    ignoreItemRefreshCalls = false;
    const itemInId    = itemIn.id;
    const itemInLabel = itemIn.label;
    const item        = itms.getById(itemInId);
    // log('getTreeItem start', itemInLabel, item?.label);
    if(!item) {
      log('err', 'getTreeItem, item not found:', itemInLabel);
      return itemIn;
    }
    item.refresh();
    if(item !== itemIn || item.id !== itemInId) {
      log('err', 'getTreeItem, item return mismatch:', 
                  itemInLabel, item.label);
      return itemIn;
    }
    // log('getTreeItem end', itemIn.label, item?.label);
    return item;
  }

  getParent(item: Item): Item | null {
    // log('getParent', item.label);
    if(item?.parent) return item.parent;
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
    // log('getChildren', item?.label);
    delayItemRefreshCalls = true;
    if(!item) {
      const tree = await getTree();
      delayItemRefreshCalls = false;
      return tree;
    }
    if(item instanceof FuncItem) {
      delayItemRefreshCalls = false;
      return [];
    }
    const children = 
             await (item as WsAndFolderItem | FileItem).getChildren();
    delayItemRefreshCalls = false;
    return children;
  }
}

export function updateItemInTree(item: Item | undefined = undefined) {
  sidebarProvider.refresh(item);
}

export async function revealItemByFunc(func: FuncItem) {
  if(!treeView.visible) return;
  const item = await itmc.getOrMakeFileItemByFsPath(func.getFsPath());
  if(!item.parent) return;
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

