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
  
export function activate(contextIn:         vscode.ExtensionContext,
                         treeViewIn:        vscode.TreeView<Item>, 
                         sidebarProviderIn: SidebarProvider) {
  context         = contextIn;
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  loadMarks();
  initGutter();
}

type AllButFuncItem = WsAndFolderItem | FileItem;

////////////////////// Items //////////////////////

class Items {
  private static itemsById:         Map<string, Item>           = new Map();
  private static fldrItemsByFspath: Map<string, AllButFuncItem> = new Map();
  private static funcItemsByFuncId: Map<string, Set<FuncItem>>  = new Map();

  getById(id: string): Item  | undefined {
    return Items.itemsById.get(id);
  }
  setFldrFile(item: AllButFuncItem) {
    if(!item.resourceUri) return;
    const fsPath = item.resourceUri.fsPath;
    Items.fldrItemsByFspath.set(fsPath, item);
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

////////////////////// WsAndFolderItem //////////////////////

export class WsAndFolderItem extends Item {
  expanded:  boolean = false;
  constructor(uri: vscode.Uri) {
    super(uri, vscode.TreeItemCollapsibleState.Expanded);
    this.id          = getItemId();
    this.resourceUri = uri;
    this.expanded    = true;
    itms.setFldrFile(this);
  }
  async getChildren() {
    if(this.children) return this.children;
    const folders: Item[] = [];
    const files:   Item[] = [];
    await getFolderChildren(this, folders, files);
    return [...folders, ...files];
  }
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

async function getFolderChildren(parent: WsAndFolderItem,
                                 folders: Item[], files: Item[]) {
  const parentFsPath = parent.resourceUri!.fsPath;
  const entries = await fs.readdir(parentFsPath, {withFileTypes: true});
  for (const entry of entries) {
    const fsPath    = path.join(parentFsPath, entry.name);
    const uri       = vscode.Uri.file(fsPath);
    if(uri.scheme !== 'file') continue;
    const isDir = entry.isDirectory();
    if(!sett.includeFile(fsPath, isDir)) continue;
    let folderFileItem = itms.getFldrFileByFsPath(fsPath);
    if (isDir) {
      folderFileItem ??= await FolderItem.create(uri);
      if(!folderFileItem) continue;
      folderFileItem.parent = parent;
      folders.push(folderFileItem);
      continue;
    }
    if(entry.isFile()) {
      if(!folderFileItem) {
        const document = await vscode.workspace.openTextDocument(uri);
        folderFileItem = new FileItem(document);
      }
      folderFileItem.parent = parent;
      files.push(folderFileItem);
      continue;
    }
  }
}

/////////////////////// WsFolderItem //////////////////////

export class WsFolderItem extends WsAndFolderItem {
  wsFolder: vscode.WorkspaceFolder;
  constructor(wsFolder: vscode.WorkspaceFolder) {
    super(wsFolder.uri);
    this.wsFolder     = wsFolder;
    this.contextValue = 'wsFolder';
  }
}

/////////////////////// FolderItem //////////////////////

export class FolderItem extends WsAndFolderItem {
  decoration?:    string;
  constructor(uri: vscode.Uri) {
    super(uri);
    this.contextValue = 'folder';
    if(settings.flattenFolders) {
      let parents = this.getParents();
      if(parents.length > 1) {
        parents = parents.reverse().slice(1);
        let decoration = '';
        for(const parent of parents) {
          decoration += path.basename(this.resourceUri!.fsPath) + '/';
        }
        this.decoration = decoration.slice(0, -1);
      }
    }
  }
  static async create(uri: vscode.Uri): Promise<FolderItem | null> {
    if (!await hasChildFuncTest(uri.fsPath)) return null;
    return new FolderItem(uri);
  }
}

////////////////////// FileItem //////////////////////

export class FileItem extends Item {
  declare parent:   WsAndFolderItem |null;
  declare children: FuncItem[]      | null;
  document:         vscode.TextDocument;
  expanded:         boolean = false;;
  filtered:         boolean = false;
  alphaSorted:      boolean = false;
  constructor(document: vscode.TextDocument) {
    const uri = document.uri;
    super(uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.document     = document;
    this.resourceUri  = uri;
    this.id           = getItemId();
    this.contextValue = 'file';
    itms.setFldrFile(this);
  }
  getChildren(): FuncItem[] {
    let structChg: boolean = false;
    if(!this.children) {
      const chgs = updateFileChildrenFromAst(this);
      if(!chgs) return [];
      structChg = chgs.structChg;
    }
    let funcItems = [...this.children as FuncItem[]];
    if(this.filtered) {
      const markSet = mrks.getMarkSet(this.document.uri.fsPath);
      funcItems = funcItems.filter(
                  func => markSet?.has((func as FuncItem).funcId));
    }
    if(this.alphaSorted) 
      funcItems.sort((a, b) => a.name.localeCompare(b.name));
    if(structChg) sbar.updateItemInTree(this);
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
  private startLine!: number;
  private endLine!:   number;
  private startKey!:  string;
  private endKey!:    string;

  constructor(params: FuncData) {
    super('', vscode.TreeItemCollapsibleState.None);
    Object.assign(this, params);
    this.contextValue = 'func';
    this.decoration   = this.getDecoration();
    this.refresh();
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked'
    };
  }
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
    if(this.isFunction(funcItem)) return `ƒ ${funcItem.name}`;
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
    let label = this.getFuncItemStr().slice(this.isFunction() ? 2 : 0) ;
    if(pointerItems.has(this)) label = '→ ' + label;
    return label;
  }
  getDecoration() {
    let decoration = '';
    for(const funcParent of this.funcParents) 
      decoration += this.getFuncItemStr(funcParent);
    // decoration += ` (${this.type})`;
    return decoration.slice(1);
  }
  getIconPath() {
     return mrks.hasMark(this) ? 
            this.iconPath = new vscode.ThemeIcon('bookmark') : undefined;
  }
  refresh(){
    this.label    = this.getLabel();
    this.iconPath = this.getIconPath();
  }
}

////////////////////// getTree //////////////////////

export async function getTree() {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (wsFolders.length > 1) {
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) 
      tree.push(new WsFolderItem(wsFolder));
    return tree;
  }
  const wsFolderItem    = new WsFolderItem(wsFolders[0]);
  const folders: Item[] = [];
  const files:   Item[] = [];
  await getFolderChildren(wsFolderItem, folders, files);
  return [...folders, ...files];
}

///////////////// updateFileChildrenFromAst //////////////////////

interface NodeData {
  id:           string;
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
  start('updateFileChildrenFromAst');
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  function empty(): {structChg: boolean, funcItems: FuncItem[]} {
    const structChg = (fileItem.children && fileItem.children.length > 0);
    fileItem.children = [];
    log(`no funcs in ${path.basename(fsPath)}`+
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
      nodeData.push({ id: '', funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
    },
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init) {
        const startName = start;
        const endName   = id.end!;
        const name      = docText.slice(start, endName);
        const type      = 'VariableDeclarator';
      nodeData.push({ id: '', funcId: '', funcParents: [],
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
      nodeData.push({ id: '', funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
      return;
    },
    Class(node) {
      if(!node.id) return;
      const {id, start, end, type} = node;
      const startName = start;
      const endName   = id.end;
      const name      = id.name;
      nodeData.push({ id: '', funcId: '', funcParents: [],
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
      nodeData.push({ id: '', funcId: '', funcParents: [],
                      name, type, start, startName, endName, end});
        return;
      }
      else {
        const name = docText.slice(start, endName);
        const type = 'Method';
      nodeData.push({ id: '', funcId: '', funcParents: [],
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
  log(`updated ${path.basename(fsPath)} funcs, `+
              `${structChg ? 'with structChg, ' : ''}`+
              `marks copied: ${matchCount} of ${funcItems.length}`);
  end('updateFileChildrenFromAst');
  return {structChg, funcItems};
}

///////////////////////////// sidebarProvider /////////////////////////////

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  
  refresh(item:Item | undefined): void {
    // log(++count, 'refresh', item?.label || 'undefined');
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(itemIn: Item): Item {
    // log(++count, 'getTreeItem', itemin.label);
    const item = itms.get(itemIn.id);
    if(!item) {
      log('err', 'getTreeItem, item not found:', itemIn.label);
      return itemIn;
    }
    item.refresh();
    return item;
  }

  getParent(item: Item): Item | null {
    // log(++count, 'getParent', item?.label || 'undefined');
    if(item?.parent) return item.parent;
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
    if(!item) return getTree();
    if(item instanceof FuncItem) return [];
    return await (item as WsAndFolderItem | FileItem).getChildren();
  }
}

export function updateItemInTree(item: Item | undefined = undefined) {
  sidebarProvider.refresh(item);
}

export async function revealItemByFunc(func: Func) {
  if(!treeView.visible) return;
  const item = await getOrMakeItemById(func.id, func);
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!item.expanded && expanded && item.contextValue === 'file') {
    await utils.revealEditorByFspath(item.id!);
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

export async function updateGutter(editor:   vscode.TextEditor, 
                                   fileItem: FileItem) {
  const children = fileItem.getChildren();
  decRanges = [];
  for(const funcItem of children) {
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
    context.workspaceState.update('markIds', mrks.getAllMarks());
    saveMarksTimer = undefined;
  }, 1000);
}

export async function setMark(funcItem: FuncItem, toggle = false, mark:boolean) {
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
  sbar.updateItemInTree(funcItem);
  const funcItemSet = itms.getFuncSetByFuncId(funcId);
  if(funcItemSet)
    for(const funcItem of funcItemSet.values()) sbar.updateItemInTree(funcItem);
  if(marked) await sbar.revealItemByFunc(funcItem);
}

let pointerItems = new Set<FuncItem>();

export async function updatePointers() {
  if(!treeView.visible) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const fsPath   = editor.document.uri.fsPath;
  const fileItem = await getOrMakeFileItemByFsPath(fsPath);
  const children = fileItem.getChildren() as FuncItem[] | undefined;
  if (!children) return;
  pointerItems.clear();
  for (const funcItem of children) {
    
  }
}

// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/
// https://github.com/estree/estree/blob/master/es5.md
// https://hexdocs.pm/estree/api-reference.html
/*
ClassExpression
YieldExpression
*/