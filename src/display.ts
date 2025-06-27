import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs/promises';
import * as acorn  from "acorn-loose";
import * as walk   from 'acorn-walk';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
const {log, start, end} = utils.getLog('disp');

let context:         vscode.ExtensionContext;
let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

export async function activate(contextIn:         vscode.ExtensionContext,
                         treeViewIn:        vscode.TreeView<Item>,
                         sidebarProviderIn: SidebarProvider) {
  context         = contextIn;
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  loadMarks();
  initGutter();
  await mrks.loadAllFilesWithFuncIds();
}

type AllButFuncItem = WsAndFolderItem | FileItem;

////////////////////// Items //////////////////////

class Items {
  private static itemsById:         Map<string, Item>           = new Map();
  private static fldrItemsByFspath: Map<string, AllButFuncItem> = new Map();
  private static funcItemsByFuncId: Map<string, Set<FuncItem>>  = new Map();

  getAllFuncItems(): FuncItem[] {
    const allFuncSets = Items.funcItemsByFuncId.values();
    const result: FuncItem[] = [];
    for(const funcSet of allFuncSets) {
      for(const funcItem of funcSet) {
        result.push(funcItem);
      }
    }
    return result;
  }
  getById(id: string): Item  | undefined {
    return Items.itemsById.get(id);
  }
  setFolderItem(item: WsAndFolderItem) {
    Items.fldrItemsByFspath.set(item.fsPath, item);
    Items.itemsById.set(item.id, item);
  }
  setFileItem(item: FileItem) {
    Items.fldrItemsByFspath.set(item.document.uri.fsPath, item);
    Items.itemsById.set(item.id, item);
  }
  getFldrFileByFsPath(fsPath:string): AllButFuncItem | null {
    return Items.fldrItemsByFspath.get(fsPath) ?? null;
  }
  setFunc(item: FuncItem) {
    if(!item.funcId) return;
    let set = Items.funcItemsByFuncId.get(item.funcId);
    if(!set) {
      set = new Set<FuncItem>();
      Items.funcItemsByFuncId.set(item.funcId, set);
    }
    set.add(item);
    Items.itemsById.set(item.id, item);
  }
  getFuncSetByFuncId(funcId: string): Set<FuncItem>  | undefined {
    return Items.funcItemsByFuncId.get(funcId);
  }
  delFuncSetByFuncId(funcId: string): Set<FuncItem> {
    const funcSet = itms.getFuncSetByFuncId(funcId) ?? new Set<FuncItem>();
    Items.funcItemsByFuncId.delete(funcId);
    return funcSet;
  }
}

export const itms = new Items();
let nextItemId = 0;
function getItemId() { return '' + nextItemId++; }

////////////////////// Item //////////////////////

export class Item extends vscode.TreeItem {
  declare id:   string;
  parent?:      Item   | null = null;
  children?:    Item[] | null = null;
  getParents(): Item[] {
    const parents: Item[] = [];
    let parent = this.parent;
    while(parent) {
      parents.push(parent);
      parent = parent.parent;
    }
    return parents;
  }
  refresh(){}
}

export async function getFuncItemsUnderNode(item: Item): Promise<FuncItem[]> {
  if (item instanceof FuncItem) return [item];
  let children: Item[] | undefined | null;
  if ('getChildren' in item && typeof (item as any).getChildren === 'function')
    children = await (item as any).getChildren(true);
  else return [];
  if (!children || children.length === 0) return [];
  let funcItem: FuncItem[] = [];
  for (const child of children)
    funcItem = funcItem.concat(await getFuncItemsUnderNode(child));
  return funcItem;
}

////////////////////// WsAndFolderItem //////////////////////

export class WsAndFolderItem extends Item {
  expanded:  boolean;
  fsPath:    string;
  root:      boolean;
  constructor(uri: vscode.Uri, root = false) {
    super(uri.path.split('/').pop()!, 
          vscode.TreeItemCollapsibleState.Expanded);
    this.id       = getItemId();
    this.expanded = true;
    this.fsPath   = uri.fsPath;
    this.root     = root;
    itms.setFolderItem(this);
  }
  /**
   * Returns the path of this item relative to the root workspace folder.
   */
  getRelativePath(): string {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) return this.fsPath;
    // Find the containing workspace folder
    const wsFolder = wsFolders.find(f => this.fsPath.startsWith(f.uri.fsPath));
    if (!wsFolder) return this.fsPath;
    let rel = this.fsPath.substring(wsFolder.uri.fsPath.length);
    if (rel.startsWith("\\") || rel.startsWith("/")) rel = rel.slice(1);
    return rel;
  }
  async getChildren() {
    if(this.children) return this.children;
    const folders: Item[] = [];
    const files:   Item[] = [];
    await getFolderChildren(this, folders, files, this.root);
    return [...folders, ...files];
  }
}

async function getFolderChildren(parent: WsAndFolderItem,
                foldersIn: Item[], filesIn: Item[], root = false) {
  const parentFsPath = parent.fsPath;
  if(root && settings.flattenFolders) {
    files.sortedFsPaths().forEach(fsPath => {
      const folderItem = getOrMakeFolderItemByFsPath(fsPath);
      if(!folderItem || parent === folderItem) return;
      folderItem.parent = parent;
      foldersIn.push(folderItem);
    });
  }
  const entries = await fs.readdir(parentFsPath, {withFileTypes: true});
  for (const entry of entries) {
    const fsPath    = path.join(parentFsPath, entry.name);
    const uri       = vscode.Uri.file(fsPath);
    if(uri.scheme !== 'file') continue;
    const isDir = entry.isDirectory();
    if(!sett.includeFile(fsPath, isDir)) continue;
    if(isDir) {
      if(settings.flattenFolders) continue;
      const folderItem = getOrMakeFolderItemByFsPath(fsPath);
      if(!folderItem) continue;
      folderItem.parent = parent;
      foldersIn.push(folderItem);
      continue;
    }
    if(entry.isFile()) {
      const fileItem = await getOrMakeFileItemByFsPath(fsPath);
      fileItem.parent = parent;
      filesIn.push(fileItem);
      continue;
    }
  }
}

/////////////////////// WsFolderItem //////////////////////

export class WsFolderItem extends WsAndFolderItem {
  wsFolder: vscode.WorkspaceFolder;
  constructor(wsFolder: vscode.WorkspaceFolder, root = false) {
    super(wsFolder.uri, root);
    this.wsFolder     = wsFolder;
    this.contextValue = 'wsFolder';
    this.iconPath     = new vscode.ThemeIcon('root-folder');
  }
  static async create(wsFolder: vscode.WorkspaceFolder, root = false): 
                                Promise<WsFolderItem> {
    await files.addPaths(wsFolder.uri.fsPath);
    return new WsFolderItem(wsFolder, root);
  }
}

/////////////////////// FolderItem //////////////////////

export class FolderItem extends WsAndFolderItem {
  decoration?:    string;
  constructor(uri: vscode.Uri) {
    super(uri);
    this.contextValue = 'folder';
    this.iconPath     = new vscode.ThemeIcon('folder');
    if(settings.flattenFolders)  {
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
  }
  static create(uri: vscode.Uri): FolderItem | null {
    if (!files.hasIncludedFile(uri.fsPath)) return null;
    return new FolderItem(uri);
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
    const funcItems = [...this.children as FuncItem[]].filter( func => {
      const marked = mrks.hasMark(func);
      func.stayVisible ||= marked;
      func.stayVisible &&= !this.filtered;
      return noFilter || marked || func.stayVisible ||
            (func.isFunction() && !this.filtered);
    });
    if(this.alphaSorted) 
      funcItems.sort((a, b) => a.name.localeCompare(b.name));
    if(structChg) updateItemInTree(this);
    return funcItems;
  };
}

export async function getOrMakeFileItemByFsPath(
                                         fsPath: string): Promise<FileItem> {
  let fileItem = itms.getFldrFileByFsPath(fsPath) as FileItem | undefined;
  if (!fileItem) {
    const uri      = vscode.Uri.file(fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    fileItem       = new FileItem(document);
  }
  return fileItem;
}

export function getOrMakeFolderItemByFsPath(fsPath: string): FolderItem {
  let folderItem = itms.getFldrFileByFsPath(fsPath) as FolderItem | undefined;
  if (!folderItem) folderItem = new FolderItem(vscode.Uri.file(fsPath));
  return folderItem;
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
  funcParents!:       FuncItem[];
  stayVisible!:       boolean;
  private startLine!: number;
  private endLine!:   number;
  private startKey!:  string;
  private endKey!:    string;

  constructor(params: FuncData) {
    super('', vscode.TreeItemCollapsibleState.None);
    Object.assign(this, params);
    this.id           = getItemId();
    this.contextValue = 'func';
    this.description  = this.getDescription();
    this.refresh();
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
  isFunction(funcItem: FuncItem = this) {
    return ['FunctionDeclaration', 'FunctionExpression',
            'ArrowFunctionExpression', 'MethodDefinition',
            'Constructor', 'Method']
            .includes(funcItem.type);
  }
  getFuncItemStr(funcItem: FuncItem = this): string {
    if(this.isFunction(funcItem)) return ` ƒ ${funcItem.name}`;
    let pfx: string;
    switch (funcItem.type) {
      case 'Property':            pfx = ':'; break;
      case 'CallExpression':      pfx = '('; break;
      case 'ClassDeclaration':
      case 'ClassExpression':     pfx = '©'; break;
      default:                    pfx = '='; break;
    }
    return ` ${pfx} ${funcItem.name}`;
  }
  getLabel() {
    // log('getLabel', this.name, this.type, pointerItems.has(this));
    let label = this.getFuncItemStr().slice(this.isFunction() ? 2 : 0) ;
    if(pointerItems.has(this)) label = '→ ' + label;
    return label.trim();
  }
  getDescription() {
    let description = '';
    for(const funcParent of this.funcParents) 
      description += this.getFuncItemStr(funcParent);
    // description += ` (${this.type})`;
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

////////////////////// getTree //////////////////////

export async function getTree() {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (wsFolders.length > 1 || !settings.hideRootFolder) {
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) 
      tree.push(await WsFolderItem.create(wsFolder, true));
    return tree;
  }
  const wsFolderItem    = await WsFolderItem.create(wsFolders[0], true);
  const folders: Item[] = [];
  const files:   Item[] = [];
  await getFolderChildren(wsFolderItem, folders, files, true);
  return [...folders, ...files];
}

///////////////// updateFileChildrenFromAst //////////////////////

interface NodeData {
  funcId:       string;
  funcParents : NodeData[];
  name:         string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
}

function updateFileChildrenFromAst(fileItem: FileItem): 
                         { structChg: boolean, funcItems: FuncItem[] } | null {
  // start('updateFileChildrenFromAst');
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  function empty(): {structChg: boolean, funcItems: FuncItem[]} {
    const structChg = (!!fileItem.children && fileItem.children.length > 0);
    fileItem.children = [];
    log(`no funcs in ${path.basename(fsPath)}`);
    end('updateFileChildrenFromAst');
    return {structChg, funcItems:[]};
  };
  const docText = document.getText();
  if (!docText || docText.length === 0) return empty();
  let ast: any;
  try {
    ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return null;
  }
  let nodeData: NodeData[] = [];
  walk.ancestor(ast, {
    Property(node){
      const {start, end, key} = node;
      const startName         = start;
      const endName           = key.end;
      const name = docText.slice(start, endName);
      const type = 'Property';
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
    },
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init) {
        const startName = start;
        const endName   = id.end!;
        const name      = docText.slice(start, endName);
        const type      = 'VariableDeclarator';
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
      }
      return;
    },
    FunctionDeclaration(node) {
      const start   = node.id!.start;
      const startName = start;
      const endName = node.id!.end;
      const end     = node.end;
      const name    = docText.slice(start, endName);
      const type    = 'FunctionDeclaration';
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
      return;
    },
    Class(node) {
      if(!node.id) return;
      const {id, start, end, type} = node;
      const startName = start;
      const endName   = id.end;
      const name      = id.name;
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
      return;
    },
    MethodDefinition(node) {
      const {start, end, key, kind} = node;
      const startName = start;
      const endName = key.end;
      if(kind      == 'constructor') {
        const name  = 'constructor';
        const type  = 'Constructor';
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
        return;
      }
      else {
        const name = docText.slice(start, endName);
        const type = 'Method';
      nodeData.push({funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
        return;
      }
    }
  });
  if(nodeData.length === 0) return empty();
  nodeData.sort((a, b) => a.start - b.start);
  for(const node of nodeData) {
    const funcParents: NodeData[] = [];
    for(const innerNode of nodeData) {
      if(innerNode === node) continue;
      if(innerNode.start > node.start) break;
      if(innerNode.end  >= node.end) funcParents.unshift(innerNode);
    }
    let funcId = node.name  + "\x00" + node.type   + "\x00";
    for(let parent of funcParents) 
      funcId += parent.name + "\x00" + parent.type + "\x00";
    funcId += fsPath;
    node.funcId      = funcId;
    node.funcParents = funcParents;
  }
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
    funcItems.push(funcItem);
    funcItemsInList.add(funcItem);
  }
  for(const funcItem of funcItems) itms.setFunc(funcItem);
  fileItem.children = funcItems;
  // log(`updated ${path.basename(fsPath)} funcs, `+
  //             `${structChg ? 'with structChg, ' : ''}`+
  //             `marks copied: ${matchCount} of ${funcItems.length}`);
  // end('updateFileChildrenFromAst', false);
  return {structChg, funcItems};
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
    for(const queueItem of refreshQueue) 
      this._onDidChangeTreeData.fire(queueItem);
    refreshQueue.length = 0;
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(itemIn: Item): Item {
    ignoreItemRefreshCalls = false;
    const itemInId    = itemIn.id;
    const itemInLabel = itemIn.label;
    const item        = itms.getById(itemIn.id);
    if(!item) {
      log('err', 'getTreeItem, item not found:', itemIn.label);
      return itemIn;
    }
    item.refresh();
    if(item !== itemIn || item.id !== itemIn.id) {
      log('err', 'getTreeItem, item return mismatch:', 
                  itemInId, itemInLabel, item.id, item.label);
      return itemIn;
    }
    return item;
  }

  getParent(item: Item): Item | null {
    // log(++count, 'getParent', item?.label || 'undefined');
    if(item?.parent) return item.parent;
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
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
    const getChildren = 
             await (item as WsAndFolderItem | FileItem).getChildren();
    delayItemRefreshCalls = false;
    return getChildren;
  }
}

export function updateItemInTree(item: Item | undefined = undefined) {
  sidebarProvider.refresh(item);
}

export async function revealItemByFunc(func: FuncItem) {
  if(!treeView.visible) return;
  const item = await getOrMakeFileItemByFsPath(func.getFsPath());
  if(!item.parent) return;
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!expanded) {
    const funcItems = await getFuncItemsUnderNode(item);
    let filesChanged = new Set<FileItem>();
    for(const funcItem of funcItems) {
      if(funcItem.stayVisible) {
        filesChanged.add(funcItem.parent);
        funcItem.clrStayVisible();
      }
    }
    for(const fileItem of filesChanged) updateItemInTree(fileItem);
  }
  if(!item.expanded && expanded && item.contextValue === 'file' &&
                                   settings.showFileOnFileOpen) {
    await utils.revealEditorByFspath((item as FileItem).document.uri.fsPath);
  }
  item.expanded = expanded;
}

////////////////////// Gutter //////////////////////

let gutDecLgtUri: vscode.Uri;
let gutDecDrkUri: vscode.Uri;
let gutterDec:    vscode.TextEditorDecorationType;
let decRanges:    vscode.DecorationOptions[] = [];

function initGutter() {
  gutDecLgtUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-lgt.svg'));
  gutDecDrkUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-drk.svg'));
  gutterDec    = getGutterDec();
}

function getGutterDec() {
  return vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    light: { gutterIconPath: gutDecLgtUri},
    dark:  { gutterIconPath: gutDecDrkUri}
  });
};

vscode.window.onDidChangeActiveColorTheme(() => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
  const editor = vscode.window.activeTextEditor;
  if(!decRanges || !editor) return;
  editor.setDecorations(gutterDec, decRanges);
});

export function updateGutter(editor:   vscode.TextEditor, 
                             fileItem: FileItem) {
  const children = fileItem.getChildren();
  decRanges = [];
  for(const funcItem of children) {
    if(!mrks.hasMark(funcItem)) continue;
    const lineNumber = funcItem.getStartLine();
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  }
  editor.setDecorations(gutterDec, decRanges);
}

////////////////////// mark data //////////////////////

class Marks {
  private static markIdSetByFspath: Map<string, Set<string>> = new Map();

  getAllMarks(): Array<[string, Set<string>]> {
    return [...Marks.markIdSetByFspath.entries()];
  }
  getMarkSet(fsPath:string): Set<string> {
    const markIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!markIdSet)    Marks.markIdSetByFspath.set(fsPath, new Set<string>());
    return            Marks.markIdSetByFspath.get(fsPath)!;
  } 
  hasMark(funcItem: FuncItem): boolean {
    const fsPath    = funcItem.getFsPath();
    const funcId    = funcItem.funcId;
    const funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) return false;
    return funcIdSet.has(funcId);
  }
  addMark(fsPath: string, funcId: string) {
    let funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) {
      funcIdSet = new Set<string>();
      Marks.markIdSetByFspath.set(fsPath, funcIdSet);
    }
    funcIdSet.add(funcId);
    saveMarks();
  }
  delMark(funcItem: FuncItem) {
    const fsPath    = funcItem.getFsPath();
    const funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) return;
    funcIdSet.delete(funcItem.funcId);
    saveMarks();
  }
  async loadAllFilesWithFuncIds() {
    const fsPaths = Marks.markIdSetByFspath.keys();
    for (const fsPath of fsPaths) {
      (await getOrMakeFileItemByFsPath(fsPath)).getChildren();
    }
  }
}
export const mrks = new Marks();

function loadMarks() {
  const fsPathMarkIdArr: Array<[string, string[]]> =  
                         context.workspaceState.get('markIds', []);
  for(const [fsPath, markIds] of fsPathMarkIdArr) {
    for(const funcId of markIds) mrks.addMark(fsPath, funcId);
  }
}

let saveMarksTimer: NodeJS.Timeout | undefined;

function saveMarks() {
  if (saveMarksTimer) clearTimeout(saveMarksTimer);
  saveMarksTimer = setTimeout(() => {
    const markIdSetArr = mrks.getAllMarks();
    const markIdArrArr = [];
    for(const [fsPath, markIdSet] of markIdSetArr) {
      markIdArrArr.push([fsPath, [...markIdSet]]);
    }
    context.workspaceState.update('markIds', markIdArrArr);
    saveMarksTimer = undefined;
  }, 1000);
}

export async function setMark(funcItem: FuncItem, toggle = false, mark:boolean = false) {
  const fsPath = funcItem.getFsPath();
  if(!fsPath) return;
  const funcId  = funcItem.funcId;
  const markSet = mrks.getMarkSet(fsPath);
  let marked    = markSet.has(funcId);
  let wasMarked = marked;
  if (toggle) marked = !marked;
  else        marked = mark;
  if(marked === wasMarked)  return;
  if(marked) mrks.addMark(fsPath, funcId);
  else       mrks.delMark(funcItem);
  updateItemInTree(funcItem.parent);
  if(marked) await revealItemByFunc(funcItem);
  const activeEditor = vscode.window.activeTextEditor;
  if(!activeEditor || activeEditor.document.uri.fsPath !== fsPath) return;
  updateGutter(activeEditor, funcItem.parent);
}

let pointerItems = new Set<FuncItem>();

export async function updatePointers() {
  if(!treeView.visible) return;
  const oldPointerItems = new Set(pointerItems);
  pointerItems.clear();
  const newPointerItems = await getFuncsOverlappingSelections();
  for(const funcItem of newPointerItems) pointerItems.add(funcItem);
  for(const funcItem of oldPointerItems) updateItemInTree(funcItem);
  for(const funcItem of newPointerItems) updateItemInTree(funcItem);
}

///////////////////// editor text //////////////////////

// export async function getFuncAtLine(
//                 fsPath: string, lineNumber: number) : FuncItem | null {
//   const fileItem = await getOrMakeFileItemByFsPath(fsPath);
//   const children = fileItem.getChildren() as FuncItem[] | undefined;
//   if (!children || children.length === 0) return null;
//   let minFunc: FuncItem | null = null;
//   let minFuncLen = 1e9;
//   for(const func of children) {
//     if(lineNumber >= func.getStartLine() && 
//        lineNumber < (func.getEndLine() + 1)) {
//       if((func.getEndLine() - func.getStartLine()) < minFuncLen) {
//         minFuncLen = func.getEndLine() - func.getStartLine();
//         minFunc = func;
//       }
//     }
//   }
//   return minFunc;
// }

export async function getFuncInAroundSelection() : Promise<FuncItem | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return null;
  const fileItem = await getOrMakeFileItemByFsPath(fsPath);
  const children = fileItem.getChildren(true) as FuncItem[] | undefined;
  if (!children || children.length === 0) return null;
  const funcsInSelection:     FuncItem[] = [];
  const funcsAroundSelection: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    for(const func of children) {
      const funcStartLine = func.getStartLine();
      const funcEndLine   = func.getEndLine();
      const selRange  = new vscode.Range(selStartLine,  0, selEndLine,  0);
      const funcRange = new vscode.Range(funcStartLine, 0, funcEndLine, 0);
      if (selRange.contains(funcRange)) funcsInSelection.push(func);
      if (funcsInSelection.length == 0 && funcRange.contains(selRange))
         funcsAroundSelection.push(func);
    }
  }
  if(funcsInSelection.length > 0) {
    let maxFuncLenIn = -1;
    let biggestFuncInSelection = null;
    for(const func of funcsInSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen > maxFuncLenIn) {
        maxFuncLenIn = funcLen;
        biggestFuncInSelection = func;
      }
    }
    return biggestFuncInSelection;
  }
  if(funcsAroundSelection.length > 0) {
    let minFuncLenAround = 1e9;
    let smallestFuncAroundSelection = null;
    for(const func of funcsAroundSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen < minFuncLenAround) {
        minFuncLenAround = funcLen;
        smallestFuncAroundSelection = func;
      }
    }
    return smallestFuncAroundSelection;
  }
  return null;
}

export async function getFuncsOverlappingSelections(): Promise<FuncItem[]> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  const fileItem = await getOrMakeFileItemByFsPath(fsPath);
  const children = fileItem.getChildren() as FuncItem[] | undefined;
  if (!children || children.length === 0) return [];
  const overlapping: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStart = selection.start.line;
    const selEnd   = selection.end.line;
    for (const func of children) {
      const funcStart = func.getStartLine();
      if(funcStart > selEnd) break;
      const funcEnd = func.getEndLine();
      if (selStart <= funcEnd && funcStart <= selEnd) {
        overlapping.push(func);
      }
    }
  }
  return overlapping;
}

export async function scrollAndFlash(editor: vscode.TextEditor, 
          startPos: vscode.Position, endPos: vscode.Position, red = false) {
  await sett.setScroll(  editor, startPos.line, endPos.line);
  utils.flashRange(editor, startPos,      endPos, red);
}

export async function revealFuncInEditor(
               itemDoc: vscode.TextDocument | FuncItem | null, red = false) {
  if(itemDoc instanceof FuncItem) {
    const document = itemDoc.parent.document;
    const editor = await vscode.window.showTextDocument(
                          document, { preview: true });
    const startPos = document.positionAt(itemDoc.start);
    const endPos   = document.positionAt(itemDoc.end);
    await scrollAndFlash(editor, startPos, endPos, red);
    utils.startDelaying('selChg');
    editor.selection = new vscode.Selection(startPos, startPos);
  }
  else if(itemDoc) await vscode.window.showTextDocument(
      itemDoc.uri, {preview: true, preserveFocus: true });
}

////////////////////// Files //////////////////////////

class Files {
  private static includedfsPaths = new Set<string>();
  clear() {
    Files.includedfsPaths.clear();
  }
  async addPaths(fsPath: string) {
    let pathCount = 0;
    async function findFuncFiles(fsPath: string) {
      let stat;
      try { stat = await fs.stat(fsPath);
      } catch { return; }
      if (stat.isDirectory()) {
        if(!sett.includeFile(fsPath, true)) return;
        let entries: string[];
        try { entries = await fs.readdir(fsPath); } 
        catch { return; }
        for (const entry of entries) {
          const childPath = path.join(fsPath, entry);
          await findFuncFiles(childPath);
        }
      }
      else if(sett.includeFile(fsPath, false)) {
        Files.includedfsPaths.add(path.dirname(fsPath));
        pathCount++;
      }
    }
    await findFuncFiles(fsPath);
    log(`addPaths, found ${pathCount} funcFiles`);
  }
  hasIncludedFile(fsPath: string): boolean {
    for(const includedPath of Files.includedfsPaths) {
      if (includedPath.startsWith(fsPath)) return true;
    }
    return false;
  }
  sortedFsPaths(): string[] {
    return Array.from(Files.includedfsPaths).sort();
  }
}
const files = new Files();

