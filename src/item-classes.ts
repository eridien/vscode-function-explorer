import * as vscode     from 'vscode';
import * as path       from 'path';
import * as fs         from 'fs/promises';
import * as sett       from './settings';
import {settings}      from './settings';
import * as utils      from './utils';
const {log, start, end} = utils.getLog('itms');

const DEBUG_FUNC_TYPE = false;
// const DEBUG_FUNC_TYPE = true;

let itms:  any;
let fils:  any;
let mrks : any;
export function setDbs(newItms:any, newFiles:any, newMarks:any) {
  itms = newItms;
  fils = newFiles;
  mrks = newMarks;
}

let pointerItems:             Set<FuncItem>;
let updateItemInTree:        (item: Item | undefined) => void = (item) => {};
let updateFileChildrenFromAst: 
     (fileItem: FileItem) => {structChg: boolean; funcItems: FuncItem[];} | null;

export function setDisp(pointerItemsIn: Set<FuncItem>) {
  pointerItems = pointerItemsIn;
}

export function setSbar(
    updateItemInTreeIn:          (item: Item | undefined) => void,
    updateFileChildrenFromAstIn: (fileItem: FileItem) => 
             {structChg: boolean; funcItems: FuncItem[];} | null) {
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
  expanded:  boolean;
  fsPath:    string;
  root:      boolean;
  constructor(uri: vscode.Uri, root = false) {
    super(path.basename(uri.fsPath),
          vscode.TreeItemCollapsibleState.Expanded);
    this.id       = getItemId();
    this.expanded = true;
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

export let itemDeleteCount = 0;

/////////////////////// FolderItem //////////////////////

export class FolderItem extends WsAndFolderItem {
  decoration?:    string;
  constructor(uri: vscode.Uri) {
    super(uri);
    this.contextValue = 'folder';
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 0) {
      const wsFolder = wsFolders.find(
            wsFolder => uri.fsPath.startsWith(wsFolder.uri.fsPath));
      if (wsFolder) {
        let rel = uri.path.substring(wsFolder.uri.path.length);
        if (rel.startsWith("/")) rel = rel.slice(1);
        if(rel.indexOf("/") !== -1) this.description = ' ' + 
                        rel.split('/').slice(0,-1).join('/') + '/';
      }
    }
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
      log('FolderItem deleted, parent:', this.parent.label);
    }
    itemDeleteCount--;
  }
}

////////////////////// FileItem //////////////////////

export class FileItem extends Item {
  declare parent:   WsAndFolderItem | null;
  declare children: FuncItem[]      | null;
  document:         vscode.TextDocument;
  expanded:         boolean = false;;
  filtered:         boolean = false;
  alphaSorted:      boolean = false;
  constructor(document: vscode.TextDocument) {
    super(document.uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.document     = document;
    this.id           = getItemId();
    this.contextValue = 'file';
    this.iconPath     = new vscode.ThemeIcon('file');
    itms.setFileItem(this);
  }
  getChildren(noFilter = false): FuncItem[] {
    let structChg: boolean = false;
    if(!this.children) {
      const chgs = updateFileChildrenFromAst(this);
      if(!chgs) return [];
      structChg = chgs.structChg;
    }
    if(!this.children) return [];
    let hasMark = false;
    const funcItems = [...this.children as FuncItem[]].filter( func => {
      if(noFilter) return true;
      const marked = mrks.hasMark(func);
      hasMark          ||= marked;
      func.stayVisible ||= marked;
      func.stayVisible &&= !this.filtered;
      return marked || func.stayVisible ||
                      (func.isFunction() && !this.filtered);
    });
    if(this.filtered && !hasMark) {
      this.filtered = false;
      structChg = true;
    }
    if(this.alphaSorted) 
      funcItems.sort((a, b) => a.name.localeCompare(b.name));
    if(structChg) updateItemInTree(this);
    return funcItems;
  };
  delete() {
    itemDeleteCount++;
    itms.deleteFileById(this.id);
    if(this.children) {
      for(const child of this.children) child.delete();
    }
    let parent = this.parent;
    while(parent) {
      parent.children = null;
      log('FileItem set to null', parent.label);
      parent = parent.parent as WsAndFolderItem | null;
    }
    itemDeleteCount--;
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
                                         fsPath: string): Promise<FileItem> {
  // log('getOrMakeFileItemByFsPath', path.basename(fsPath));
  let fileItem = itms.getFldrFileByFsPath(fsPath) as FileItem | undefined;
  if (!fileItem) {
    const uri      = vscode.Uri.file(fsPath);

    const document = await vscode.workspace.openTextDocument(uri);

    fileItem       = new FileItem(document);
  }
  return fileItem;
}

export function toggleMarkedFilter(fileItem: FileItem) {
  fileItem.filtered = !fileItem.filtered;
 updateItemInTree(fileItem);
}

export function toggleAlphaSort(fileItem: FileItem) {
  fileItem.alphaSorted = !fileItem.alphaSorted;
 updateItemInTree(fileItem);
}


////////////////// FuncItem //////////////////////

interface FuncData {
  parent:    FileItem;
  name:      string;
  type:      string;
  start:     number;
  startName: number;
  endName:   number;
  end:       number;
}

export class FuncItem extends Item {
  declare parent:     FileItem;
  name!:              string;
  decoration!:        string;
  type!:              string;
  start!:             number;
  startName!:         number;
  endName!:           number;
  end!:               number;
  funcId!:            string;
  funcParents!:       [string, string][];
  stayVisible!:       boolean;
  private startLine: number | undefined;
  private endLine:   number | undefined;
  private startKey:  string | undefined;
  private endKey:    string | undefined;

  constructor(params: FuncData) {
    super('', vscode.TreeItemCollapsibleState.None);
    Object.assign(this, params);
    this.id           = getItemId();
    this.contextValue = 'func';
    this.description  = this.getDescription();
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [this]
    };
  }
  clrStayVisible() { this.stayVisible = false; }
  getFsPath()    {return this.parent.document.uri.fsPath;}
  getStartLine() {return this.startLine ??= 
                         this.parent.document.positionAt(this.start).line;};
  getEndLine()   {return this.endLine   ??= 
                         this.parent.document.positionAt(this.end).line;};
  getStartKey()  {return this.startKey  ??= 
     utils.createSortKey(this.getFsPath(), this.getStartLine());};
  getEndKey()    {return this.endKey    ??= 
     utils.createSortKey(this.getFsPath(), this.getEndLine());};
  isFunction(type: string = this.type): boolean {
    return ["function_declaration", "function_expression", 
            "method_definition", "arrow_function"].includes(type);
  }
  clear() {
    this.startLine = undefined;
    this.endLine   = undefined;
    this.startKey  = undefined;
    this.endKey    = undefined;
  }
  getFuncItemStr(nameType: [string, string]): string {
    const [name, type] = nameType;
    if(this.isFunction(type)) return ` ƒ ${name}`;
    let pfx: string;
    switch (type) {
      case 'object':            pfx = ':'; break;
      case 'class_declaration': pfx = '©'; break;
      default:                  pfx = '='; break;
    }
    return ` ${pfx} ${name}`;
  }
  getLabel() {
    // log('getLabel', this.name, this.type, pointerItems.has(this));
    let label = this.name;
    if(!this.isFunction())     
      label = this.getFuncItemStr([label, this.type]);
    if(pointerItems.has(this)) label = '→ ' + label;
    return label.trim();
  }
  getDescription() {
    let description = '';
    for(const funcParent of this.funcParents) 
      description += this.getFuncItemStr(funcParent);
    if(DEBUG_FUNC_TYPE) description += `   (${this.type})`;
    return description.slice(1).trim();
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
                                     filtered = true) : Promise<FuncItem[]> {
  let funcs: FuncItem[] = [];
  if(!fileWrap) {
    const fileItem = await getOrMakeFileItemByFsPath(fsPath);
    funcs          = fileItem.getChildren(!filtered);
  }
  else funcs = itms.getAllFuncItems();
  if(funcs.length === 0) return [];
  if(filtered) funcs = funcs.filter(func => mrks.hasMark(func));
  if (fileWrap) {
    return funcs.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return +1;
      if (a.getStartKey() < b.getStartKey()) return -1;
      return 0;
    });
  } 
  return funcs.sort((a, b) => a.start - b.start);
}
