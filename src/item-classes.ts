import * as vscode     from 'vscode';
import * as path       from 'path';
import * as fs         from 'fs/promises';
import {FuncData}      from './parse';
import * as sett       from './settings';
import {settings}      from './settings';
import * as utils      from './utils';
const {log, start, end} = utils.getLog('itms');

const DEBUG_FUNC_TYPE = false;

let treeView: vscode.TreeView<Item>;
export function activate(treeViewIn: vscode.TreeView<Item>) {
  treeView = treeViewIn;
}

let itms:  any;
let mrks : any;
export function setDbs(newItms:any, newFiles:any, newMarks:any) {
  itms = newItms;
  mrks = newMarks;
}

let updateItemInTree:        (item: Item | undefined) => void = (item) => {};
let updateFileChildrenFromAst: 
     (fileItem: FileItem) =>
       Promise<{structChg: boolean; funcItems: FuncItem[];} | null>;

export function setSbar(
    updateItemInTreeIn:          (item: Item | undefined) => void,
    updateFileChildrenFromAstIn: (fileItem: FileItem) => 
             Promise<{structChg: boolean; funcItems: FuncItem[];} | null>) {
  updateItemInTree          = updateItemInTreeIn;
  updateFileChildrenFromAst = updateFileChildrenFromAstIn;
}

let nextItemId = 0;
function getItemId() { return '' + nextItemId++; }

////////////////////// Item //////////////////////

export class Item extends vscode.TreeItem {
  declare id:   string;
  parent?:      Item   | null = null;
  children?:    Item[] | null = null;
  refresh() {}
  clear()   {}
}

export async function getFuncItemsUnderNode(item: Item): Promise<FuncItem[]> {
  if (item instanceof FuncItem) return [item];
  let children: Item[] | undefined | null;
  if ('getChildren' in item && typeof (item as any).getChildren === 'function')
    children = await (item as any).getChildren(true);
  else return [];
  if (!children || children.length === 0) return [];
  let funcItems: FuncItem[] = [];
  for (const child of children)
    funcItems = funcItems.concat(await getFuncItemsUnderNode(child));
  return funcItems;
}

export async function getFolderChildren(parent: WsAndFolderItem,
                foldersIn: Item[], filesIn: Item[], root = false) {
  // log('getFolderChildren', parent.label, root, settings);
  if(root && settings.hideFolders) {
    for(const fsPath of fils.sortedFsPaths()) {
      const fileItem = await getOrMakeFileItemByFsPath(fsPath);
      if(!fileItem || fileItem.contextValue !== 'file' ||
         !fileItem.document.uri.fsPath.startsWith(parent.fsPath)) {
        continue;
      }
      fileItem.parent = parent;
      filesIn.push(fileItem);
    };
    return;
  }
  else if(root) {
    (fils.sortedFsPaths() as string[]).forEach(fsPath => {
      const folderItem = getOrMakeFolderItemByFsPath(fsPath);
      if(!folderItem || parent === folderItem    ||
          folderItem.contextValue === 'wsFolder' ||
         !folderItem.fsPath?.startsWith(parent.fsPath)) 
        return;
      folderItem.parent = parent;
      foldersIn.push(folderItem);
    });
  }
  try {
    const parentFsPath = parent.fsPath;
    const entries = await fs.readdir(parentFsPath, {withFileTypes: true});
    for (const entry of entries) {
      const fsPath    = path.join(parentFsPath, entry.name);
      const uri       = vscode.Uri.file(fsPath);
      if(uri.scheme !== 'file') continue;
      const isDir = entry.isDirectory();
      if(!sett.includeFile(fsPath, isDir)) continue;
      if(isDir) continue;
      if(entry.isFile()) {
        const fileItem = await getOrMakeFileItemByFsPath(fsPath);
        if(!fileItem) continue;
        fileItem.parent = parent;
        filesIn.push(fileItem);
        continue;
      }
    }
  }
  catch (error) { 
    log('err', 'getFolderChildren readdir parent:', parent.fsPath);
    return; 
  }
}

////////////////////// WsAndFolderItem //////////////////////

export class WsAndFolderItem extends Item {
  fsPath:    string;
  root:      boolean;
  constructor(uri: vscode.Uri, root = false) {
    super(path.basename(uri.fsPath),
          vscode.TreeItemCollapsibleState.Expanded);
    this.id       = getItemId();
    this.fsPath   = uri.fsPath;
    this.root     = root;
    itms.setFolderItem(this);
  }
  async getChildren() {
    if(this.children) return this.children;
    const folders: Item[] = [];
    const files:   Item[] = [];
    await getFolderChildren(this, folders, files, this.root);
    return [...folders, ...files];
  }
  clear() {
    this.children = null;
    this.root     = false;
  }
}

/////////////////////// WsFolderItem //////////////////////

export class WsFolderItem extends WsAndFolderItem {
  wsFolder: vscode.WorkspaceFolder;
  constructor(wsFolder: vscode.WorkspaceFolder, root = false) {
    super(wsFolder.uri, root);
    this.wsFolder     = wsFolder;
    this.contextValue = 'wsFolder';
    // this.iconPath     = new vscode.ThemeIcon('root-folder');
  }
  static create(wsFolder: vscode.WorkspaceFolder, root = false): WsFolderItem {
    return new WsFolderItem(wsFolder, root);
  }
}

export function getPathCrumbs(fsPath: string): string {
  let crumbs = '';
  const wsFolders = vscode.workspace.workspaceFolders;
  if (wsFolders && wsFolders.length > 0) {
    const wsFolder = wsFolders.find(
          wsFolder => fsPath.startsWith(wsFolder.uri.fsPath));
    if (wsFolder) {
      let rel = fsPath.substring(wsFolder.uri.fsPath.length);
      if (rel.startsWith(path.sep)) rel = rel.slice(1);
      if(rel.indexOf(path.sep) !== -1) crumbs = ' ' + 
                      rel.split(path.sep).slice(0,-1).join('/') + '/';
    }
  }
  return crumbs;
}

export let itemDeleteCount = 0;

/////////////////////// FolderItem //////////////////////

export class FolderItem extends WsAndFolderItem {
  decoration?:    string;
  constructor(uri: vscode.Uri) {
    super(uri);
    this.contextValue = 'folder';
    this.description  = getPathCrumbs(uri.fsPath);
  }
  static create(uri: vscode.Uri): FolderItem | null {
    if (!fils.hasIncludedFile(uri.fsPath)) return null;
    return new FolderItem(uri);
  }
  delete()  {
    itemDeleteCount++;
    itms.deleteFolderById(this.id);
    fils.deleteByFsPath(this.fsPath);
    if(this.children) {
      for(const child of this.children) {
        if(child instanceof FolderItem || 
           child instanceof FileItem) 
          child.delete();
      }
    }
    if(this.parent) {
      this.parent.children = null;
      // log('FolderItem deleted, parent:', this.parent.label);
    }
    itemDeleteCount--;
  }
}

////////////////////// FileItem //////////////////////

export class FileItem extends Item {
  declare parent:   WsAndFolderItem | null;
  declare children: FuncItem[]      | null;
  document:         vscode.TextDocument;
  expanded:         boolean = false;
  filtered:         boolean = false;
  alphaSorted:      boolean;
  constructor(document: vscode.TextDocument) {
    super(document.uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.document = document;
    this.refresh();
    this.id            = getItemId();
    this.contextValue  = 'file';
    this.iconPath      = new vscode.ThemeIcon('file');
    this.alphaSorted   = settings.alphaSortFunctions;
    itms.setFileItem(this);
  }
  async getChildren(noFilter = false): Promise<FuncItem[]> {
    let structChg: boolean = false;
    if(!this.children) {
      const chgs = await updateFileChildrenFromAst(this);
      if(!chgs) return [];
      structChg = chgs.structChg;
    }
    if(!this.children || this.children.length === 0) return [];
    let hasMark = false;
    const funcItems = [...this.children as FuncItem[]].filter( func => {
      if(noFilter) return true;
      const marked  = mrks.hasMark(func);
      let stayAlive = mrks.hasStayAlive(func);
      hasMark       ||= marked;
      stayAlive     ||= marked;
      stayAlive     &&= !this.filtered;
      if(stayAlive && !func.isFunction) mrks.addStayAlive(func);
      return marked || stayAlive || (func.isFunction && !this.filtered);
    });
    if(funcItems.length === 0) return [];
    if(this.filtered && !hasMark) {
      this.filtered = false;
      structChg = true;
    }
    if(this.alphaSorted) 
                funcItems.sort((a, b) => a.name.localeCompare(b.name));
    funcItems[0].prevSibling = undefined;
    for(let idx = 1; idx < funcItems.length; idx++) {
      const funcItem = funcItems[idx];
      funcItem.prevSibling = funcItems[idx-1];
    }
    if(structChg) updateItemInTree(this);
    return funcItems;
  }
  async hasMarks(): Promise<boolean> {
    const children = await this.getChildren();
    return children.length > 0;
  }
  delete() {
    itemDeleteCount++;
    fils.deleteByFsPath(this.document.uri.fsPath);
    itms.deleteFileById(this.id);
    if(this.children) {
      for(const child of this.children) child.delete();
    }
    let parent = this.parent;
    while(parent) {
      parent.children = null;
      // log('FileItem set to null', parent.label);
      parent = parent.parent as WsAndFolderItem | null;
    }
    itemDeleteCount--;
  }
  refresh() {
    if(settings.hideFolders && settings.showFilePaths) 
      this.description = getPathCrumbs(this.document.uri.fsPath);
    else this.description = '';
  }
  clear() {
    this.children = null;
  }
}

export function getOrMakeWsFolderItem(wsFolder: vscode.WorkspaceFolder):
                                                       WsFolderItem {
  let wsFolderItem = 
    itms.getFldrFileByFsPath(wsFolder.uri.fsPath) as WsFolderItem | undefined;
  if (!wsFolderItem) wsFolderItem = WsFolderItem.create(wsFolder, true);
  wsFolderItem.root = true;
  return wsFolderItem;
}

export function getOrMakeFolderItemByFsPath(fsPath: string): FolderItem {
  let folderItem = itms.getFldrFileByFsPath(fsPath) as FolderItem | undefined;
  if (!folderItem) folderItem = new FolderItem(vscode.Uri.file(fsPath));
  return folderItem;
}

export async function getOrMakeFileItemByFsPath(
                            fsPath: string): Promise<FileItem | null> {
  // log('getOrMakeFileItemByFsPath', path.basename(fsPath));
  let fileItem = itms.getFldrFileByFsPath(fsPath) as FileItem | undefined;
  if (!fileItem) {
    const uri      = vscode.Uri.file(fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    fileItem = new FileItem(document);
  }
  return fileItem;
}

export function toggleMarkedFilter(fileItem: FileItem) {
  fileItem.filtered = !fileItem.filtered;
  treeView.reveal(fileItem, {expand: true, select: true, focus: false});
  updateItemInTree(fileItem);
}

export function toggleAlphaSort(fileItem: FileItem) {
  fileItem.alphaSorted = !fileItem.alphaSorted;
 updateItemInTree(fileItem);
}

////////////////// FuncItem //////////////////////

export class FuncItem extends Item {
  declare parent: FileItem;
  prevSibling?:   FuncItem;
  descr?:         string;
  lang!:          string;
  name!:          string;
  decoration!:    string;
  type!:          string;
  start!:         number;
  startName!:     number;
  endName!:       number;
  end!:           number;
  funcId!:        string;
  isFunction!:    boolean;
  private startLine: number | undefined;
  private endLine:   number | undefined;
  private nameLine:  number | undefined;
  private startKey:  string | undefined;
  private endKey:    string | undefined;

  constructor(funcData: FuncData, parent: FileItem) {
    super('', vscode.TreeItemCollapsibleState.None);
    Object.assign(this, funcData);
    this.id           = getItemId();
    this.parent       = parent;
    this.contextValue = 'func';
    this.description  = this.getDescription() as string;
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [this]
    };
  }
  getFsPath()    {return this.parent.document.uri.fsPath;}
  getStartLine() {return this.startLine ??= 
                        this.parent.document.positionAt(this.start).line;};
  getNameLine()  {return this.nameLine  ??= 
                        this.parent.document.positionAt(this.startName).line;};
  getEndLine()   {return this.endLine   ??= 
                         this.parent.document.positionAt(this.end).line;};
  getStartKey()  {return this.startKey  ??= 
     utils.createSortKey(this.getFsPath(), this.getStartLine());};
  getEndKey()    {return this.endKey    ??= 
     utils.createSortKey(this.getFsPath(), this.getEndLine());};
  clear() {
    this.startLine = undefined;
    this.endLine   = undefined;
    this.nameLine  = undefined;
    this.startKey  = undefined;
    this.endKey    = undefined;
  }
  getFuncItemStr(name: string, symType: string): string {
    const symbol = symType[0];
    return ` ${symbol} ${name}`;
  }
  getLabel() {
    const nameType = this.funcId.split('\x01')[0];
    const symType  = nameType.split('\x02')[1];
    return this.isFunction ? this.name 
                           : this.getFuncItemStr(this.name, symType);
  }
  getDescription(): string {
    if(settings.showBreadcrumbs === 'Never Show Breadcrumbs') return '';
    else {
      const prevDescr = this.prevSibling?.descr ?? '';
      let description = '';
      let thisFuncIdParts = this.funcId.split('\x01').slice(1,-2);
      for(const part of thisFuncIdParts) {
        if(part.length === 0) continue;
        const [name, symType] = part.split('\x02');
        if(!name || name === '' || !symType || symType === '') continue;
        description = this.getFuncItemStr(name, symType) + description;
      }
      description = description.slice(1).trim();
      this.descr  = description;
      if(prevDescr !== '' && 
         settings.showBreadcrumbs === 'Show Breadcrumbs With Dittos' && 
                      description === prevDescr)
        description = ' "';
      if(DEBUG_FUNC_TYPE) description += `   (${this.type})`;
      return description;
    }
  }
  getIconPath() {
     return mrks.hasMark(this) ? new vscode.ThemeIcon('bookmark') : undefined;
  }
  refresh(){
    this.label       = this.getLabel();
    this.description = this.getDescription();
    this.iconPath    = this.getIconPath();
  }
  delete() {
    itemDeleteCount++;
    itms.deleteFuncById(this.id);
    itms.delFuncSetByFuncId(this.funcId);
    if(this.parent) this.parent.children = null;
    itemDeleteCount--;
  }
}

export async function getSortedFuncs(fsPath: string, fileWrap = true, 
                    filtered = true, funcOnly = false, allTabs = false) 
                                                    :Promise<FuncItem[]> {
  let funcs: FuncItem[] = [];
  if(!fileWrap) {
    const fileItem = await getOrMakeFileItemByFsPath(fsPath);
    if(!fileItem) return [];
    funcs = await fileItem.getChildren(!filtered);
  }
  else funcs = await itms.getAllFuncItems(allTabs);
  if(funcs.length === 0) return [];
  if(filtered && !funcOnly) funcs = funcs.filter(func => mrks.hasMark(func));
  if(funcOnly)              funcs = funcs.filter(func => func.isFunction);
  if (fileWrap) {
    return funcs.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return +1;
      if (a.getStartKey() < b.getStartKey()) return -1;
      return 0;
    });
  } 
  return funcs.sort((a, b) => a.start - b.start);
}
