import * as vscode          from 'vscode';
import * as path            from 'path';
import * as parse           from './parse';
import {fils, mrks, itms}   from './dbs';
import * as itmc            from './item-classes';
import {Item, WsAndFolderItem,
        FileItem, FuncItem} from './item-classes';
import * as sett            from './settings';
import {settings}           from './settings';
import * as utils           from './utils';
import {extStatus}          from './utils';
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
  if(extStatus.isAborted()) return [];
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (!settings.hideFolders && !settings.hideRootFolders) {
    const tree: Item[] = [];
    let firstWsFolder = true;
    for(const wsFolder of wsFolders) {
      await fils.loadPaths(wsFolder.uri.fsPath, firstWsFolder);
      const wsFolderItem = itmc.getOrMakeWsFolderItem(wsFolder);
      tree.push(wsFolderItem);
      firstWsFolder = false;
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

  refreshTree() {
    this._onDidChangeTreeData.fire(undefined);
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
  // if(!treeView.visible) return;
  treeView.reveal(func, {expand: true, select: true, focus: false});
}

///////////////// updateFileChildrenFromAst //////////////////////

export async function updateFileChildrenFromAst(fileItem: FileItem): 
               Promise<{ structChg: boolean; funcItems: FuncItem[]; } | null> {
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  function empty(): {structChg: boolean, funcItems: FuncItem[]} {
    const structChg = (!!fileItem.children && fileItem.children.length > 0);
    fileItem.children = null;
    log(`no funcs in ${path.basename(fsPath)}`);
    return {structChg, funcItems:[]};
  };
  const docText = document.getText();
  if (!docText || docText.length === 0) return empty();
  const funcDataArr = await parse.parseCode(docText, fsPath, document);
  if(!funcDataArr || funcDataArr.length === 0) return empty();
  let matchCount = 0;
  let structChg  = false;
  const children = fileItem.children as FuncItem[] | undefined;
  let   childIdx = 0;
  const funcItemsInList = new Set<FuncItem>();
  const funcItems: FuncItem[] = [];
  for(const funcDataFromAst of funcDataArr) {
    let childFuncItem: FuncItem | undefined = undefined;
    if(!structChg) childFuncItem = children?.[childIdx++];
    if(childFuncItem?.funcId !== funcDataFromAst.funcId) {
      structChg = true;
      const funcSet = itms.getFuncSetByFuncId(funcDataFromAst.funcId);
      if(funcSet) {
        for(const funcItem of funcSet.values()) {
          if(!funcItemsInList.has(funcItem)) {
            childFuncItem = funcItem;
            funcSet.delete(childFuncItem);
            break;
          }
        }
      }
      childFuncItem ??= new FuncItem(funcDataFromAst, fileItem);
    }
    else matchCount++;
    Object.assign(childFuncItem, funcDataFromAst);
    childFuncItem.clear();
    funcItems.push(childFuncItem);
    funcItemsInList.add(childFuncItem);
  }
  for(const funcItem of funcItems) itms.setFunc(funcItem);
  fileItem.children = funcItems;
  // log(`updated ${path.basename(fsPath)} funcs, `+
  //             `${structChg ? 'with structChg, ' : ''}`+
  //             `marks copied: ${matchCount} of ${funcItems.length}`);
  // end('updateFileChildrenFromAst', true);
  return {structChg, funcItems};
}

///////////////// getAllFuncItemsFromAst //////////////////////

export async function getAllFuncItemsFromAst(fileItem: FileItem): 
                                               Promise<FuncItem[]> {
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return [];
  const docText = document.getText();
  if (!docText || docText.length === 0) return [];
  const funcDataArr = await parse.parseCode(
                          docText, fsPath, document, false, null, true);
  if(!funcDataArr || funcDataArr.length === 0) return [];
  const funcItems: FuncItem[] = [];
  for(const funcData of funcDataArr) {
    let items = itms.getFuncItemsByFuncId(funcData.funcId);
    if(items.length == 0) items.push(new FuncItem(funcData, fileItem));
    for(const funcItem of items) funcItems.push(funcItem);
  }
  return funcItems;
}

let blockChg = false;
export function blockExpChg() { blockChg = true; }
let blockChgTimeout: NodeJS.Timeout | undefined;

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!(item instanceof FileItem)) return;
  if (blockChg) {
    if(blockChgTimeout) clearTimeout(blockChgTimeout);
    blockChgTimeout   = setTimeout(() => {
      blockChg        = false;
      blockChgTimeout = undefined;
    }, 2000);
    return undefined;
  }
  if(!expanded) {
    const funcItems = await itmc.getFuncItemsUnderNode(item);
    let filesChanged = new Set<FileItem>();
    let haveMark = false;
    for(const funcItem of funcItems) {
      if(mrks.hasMark(funcItem)) haveMark = true;
      if(mrks.hasStayAlive(funcItem))
         filesChanged.add(funcItem.parent);
    }
    mrks.clrStayAlive(item.document.uri.fsPath);
    if(!haveMark && item.filtered) {
      filesChanged.add(item);
      item.filtered = false;
    }
    for(const fileItem of filesChanged) updateItemInTree(fileItem);
  }
  else {
    if(settings.openFileWhenExpanded)
      await utils.revealEditorByFspath(item.document.uri.fsPath, 
                                              !settings.openEditorsAsPinned); 
  }
  item.expanded = expanded;
}

