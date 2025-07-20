import * as vscode          from 'vscode';
import * as path            from 'path';
import * as parse           from './parse';
import {fils, itms}         from './dbs';
import * as itmc            from './item-classes';
import {Item, WsAndFolderItem,
        FileItem, FuncItem} from './item-classes';
import * as sett            from './settings';
import {settings}           from './settings';
import * as utils           from './utils';
const {log, start, end} = utils.getLog('sbar');

let treeView:  vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

export function activate(treeViewIn: vscode.TreeView<Item>,
                        sidebarProviderIn: SidebarProvider) {
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  itmc.setSbar(updateItemInTree, updateFileChildrenFromAst as any);
}

////////////////////// getTree //////////////////////

export async function getTree() {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (!settings.hideFolders && !settings.hideRootFolders) {
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) {
      await fils.loadPaths(wsFolder.uri.fsPath);
      const wsFolderItem = itmc.getOrMakeWsFolderItem(wsFolder);
      tree.push(wsFolderItem);
    }
    return tree;
  }
  const foldersIn: Item[] = [];
  const filesIn:   Item[] = [];
  for(const wsFolder of wsFolders){
    await fils.loadPaths(wsFolder.uri.fsPath);
    const wsFolderItem = itmc.getOrMakeWsFolderItem(wsFolder);
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
    // log('getTreeItem start', item?.contextValue, itemIn.label, item?.label);
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
    // log('getTreeItem end', item?.contextValue, itemIn.label, item?.label);
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
      // log('getChildren root', tree.length);
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
  if(sidebarProvider) sidebarProvider.refresh(item);
}

export async function refreshTree(updateFuncs = false) {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'refreshTree, No folders in workspace');
    return;
  }
  for(const wsFolder of wsFolders)
    await fils.loadPaths(wsFolder.uri.fsPath);
  itms.getAllFolderFileItems().forEach(async item => {
    item.clear();
    if(updateFuncs && item instanceof FileItem) {
      await updateFileChildrenFromAst(item);
      updateItemInTree(item);
    }
  });
  if(sidebarProvider) sidebarProvider.refresh(undefined);
}

export function revealItemByFunc(func: FuncItem) {
  if(!treeView.visible) return;
  treeView.reveal(func, {expand: true, select: true, focus: false});
}

///////////////// updateFileChildrenFromAst //////////////////////

export async function updateFileChildrenFromAst(fileItem: FileItem): 
               Promise<{ structChg: boolean; funcItems: FuncItem[]; } | null> {
  start('updateFileChildrenFromAst', true);
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  function empty(): {structChg: boolean, funcItems: FuncItem[]} {
    const structChg = (!!fileItem.children && fileItem.children.length > 0);
    fileItem.children = null;
    log(`no funcs in ${path.basename(fsPath)}`);
    end('updateFileChildrenFromAst', true);
    return {structChg, funcItems:[]};
  };
  const docText = document.getText();
  if (!docText || docText.length === 0) return empty();
  const nodeData = await parse.parseCode(
                                   fileItem.lang, docText, fsPath, document);
  if(!nodeData || nodeData.length === 0) return empty();
  let matchCount              = 0;
  let structChg               = false;
  const children              = fileItem.children as FuncItem[] | undefined;
  let   childIdx              = 0;
  const funcItemsInList       = new Set<FuncItem>();
  const funcItems: FuncItem[] = [];
  for(const node of nodeData) {
    let funcItem: FuncItem | undefined = undefined;
    if(!structChg) funcItem = children?.[childIdx++];
    if(funcItem?.funcId !== node.funcId) {
      structChg = true;
      const funcSet = itms.getFuncSetByFuncId(node.funcId);
      if(funcSet) {
        for(const funcFromSet of funcSet.values()) {
          if(!funcItemsInList.has(funcFromSet)) {
            funcItem = funcFromSet;
            funcSet.delete(funcItem);
            break;
          }
        }
      }
      funcItem ??= new FuncItem({...node, parent:fileItem});
    }
    else matchCount++;
    Object.assign(funcItem, node);
    funcItem.clear();
    funcItems.push(funcItem);
    funcItemsInList.add(funcItem);
  }
  for(const funcItem of funcItems) itms.setFuncItem(funcItem);
  fileItem.children = funcItems;
  // log(`updated ${path.basename(fsPath)} funcs, `+
  //             `${structChg ? 'with structChg, ' : ''}`+
  //             `marks copied: ${matchCount} of ${funcItems.length}`);
  end('updateFileChildrenFromAst', true);
  return {structChg, funcItems};
}
