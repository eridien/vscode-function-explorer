import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as acorn  from "acorn-loose";
import * as walk   from 'acorn-walk';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
const {log, start, end} = utils.getLog('item');

let nextItemId = 0;
function getItemId() { return '' + nextItemId++; }

let context: vscode.ExtensionContext;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  loadMarks();
}

type AllButFuncItem = WsAndFolderItem | FileItem;

////////////////////// Items //////////////////////

class Items {
  private static itemsById:         Map<string, Item>           = new Map();
  private static fldrItemsByFspath: Map<string, AllButFuncItem> = new Map();
  private static funcItemsByFuncId: Map<string, Set<FuncItem>>  = new Map();
  private static markIdSetByFspath: Map<string, Set<string>>    = new Map();

  setFldrFile(item: AllButFuncItem) {
    if(!item.resourceUri) return;
    const fsPath = item.resourceUri.fsPath;
    Items.fldrItemsByFspath.set(fsPath, item);
    Items.itemsById.set(item.id, item);
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
  setMark(fsPath: string, funcId: string) {
    let funcIdSet = Items.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) {
      funcIdSet = new Set<string>();
      Items.markIdSetByFspath.set(fsPath, funcIdSet);
    }
    funcIdSet.add(funcId);
  }
  get(id: string): Item  | undefined {
    return Items.itemsById.get(id);
  }
  getFldrFile(fsPath:string): AllButFuncItem | undefined {
    return Items.fldrItemsByFspath.get(fsPath);
  }
  getFuncSet(funcId: string): Set<FuncItem>  | undefined {
    return Items.funcItemsByFuncId.get(funcId);
  }
  delFuncSet(funcId: string): Set<FuncItem> {
    const funcSet = itms.getFuncSet(funcId) ?? new Set<FuncItem>();
    Items.funcItemsByFuncId.delete(funcId);
    return funcSet;
  }
  getMarkSet(fsPath:string): Set<string> | undefined {
    return Items.markIdSetByFspath.get(fsPath);
  } 
}
const itms = new Items();

////////////////////// Item //////////////////////

class Item extends vscode.TreeItem {
  declare id: string;
  parent?:    Item   | null = null;
  children?:  Item[] | null = null;
  getParents(): Item[] {
    const parents: Item[] = [];
    let parent = this.parent;
    while(parent) {
      parents.push(parent);
      parent = parent.parent;
    }
    return parents;
  }
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
    await getFolderFileChildren(this, folders, files);
    return [...folders, ...files];
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
  constructor(uri: vscode.Uri, parent: WsAndFolderItem) {
    super(uri);
    this.parent = parent;
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
  static async create(uri: vscode.Uri, parent: WsAndFolderItem): 
                                               Promise<FolderItem | null> {
    if (!await sbar.hasChildFuncTest(uri.fsPath)) return null;
    return new FolderItem(uri, parent);
  }
}

////////////////////// FileItem //////////////////////

export class FileItem extends Item {
  declare parent:   WsAndFolderItem;
  declare children: FuncItem[];
  document:         vscode.TextDocument;
  expanded:         boolean = false;;
  filtered:         boolean = false;
  alphaSorted:      boolean = false;
  constructor(parent: WsAndFolderItem, document: vscode.TextDocument) {
    const uri = document.uri;
    super(uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent       = parent;
    this.document     = document;
    this.resourceUri  = uri;
    this.id           = getItemId();
    this.contextValue = 'file';
    itms.setFldrFile(this);
  }
  getChildren(): FuncItem[] {
    if(this.children) return this.children;
    else {
      const funcItemsFromFile = getFuncItemsFromFileAst(this);
      if(!funcItemsFromFile) return [];
      let {structChg, funcItems} = funcItemsFromFile;
      this.children = [...funcItems];
      if(this.filtered) {
        const markSet = itms.getMarkSet(this.document.uri.fsPath);
        funcItems = funcItems.filter(
                    func => markSet?.has((func as FuncItem).funcId));
      }
      if(this.alphaSorted) 
        funcItems.sort((a, b) => a.name.localeCompare(b.name));
      if(structChg) sbar.updateItem(this);
      return funcItems;
    }
  };
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
  declare parent: FileItem;
  name!:        string;
  decoration!:  string;
  type!:        string;
  start!:       number;
  startName!:   number;
  endName!:     number;
  end!:         number;
  funcId!:      string;
  funcParents!: FuncItem[];
  startLine!:   number;
  endLine!:     number;
  startKey!:    string;
  endKey!:      string;
  marked:       boolean = false;
  constructor(params: FuncData) {
    super('', vscode.TreeItemCollapsibleState.None);
    Object.assign(this, params);
    this.contextValue = 'func';
    this.label        = this.getLabel();
    this.decoration   = this.getDecoration();
    this.marked       = false;
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked'
    };
  }
  getStartLine() {return this.startLine ??= 
                         this.parent.document.positionAt(this.start).line;};
  getEndLine()   {return this.endLine   ??= 
                         this.parent.document.positionAt(this.end).line;};
  getStartKey()  {return this.startKey  ??= utils.createSortKey
                 (this.parent.document.uri.fsPath, this.getStartLine());};
  getEndKey()    {return this.endKey    ??= utils.createSortKey
                        (this.parent.document.uri.fsPath, this.getEndLine());};
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
    return this.getFuncItemStr().slice(this.isFunction() ? 2 : 0) ;
  }
  getDecoration() {
    let decoration = '';
    for(const funcParent of this.funcParents) 
      decoration += this.getFuncItemStr(funcParent);
    // decoration += ` (${this.type})`;
    return decoration.slice(1);
  }
}

///////////////// getFuncItemsFromFileAst //////////////////////

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

function getFuncItemsFromFileAst(fileItem: FileItem): 
    { structChg: boolean, funcItems: FuncItem[] } | null {
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  const docText = document.getText();
  if (!docText || docText.length === 0) return null;
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
      const funcSet = itms.getFuncSet(node.funcId);
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
  console.log(`updated ${path.basename(fsPath)} funcs, `+
                      `${structChg ? 'with structChg, ' : ''}`+
                      `marks copied: ${matchCount} of ${funcItems.length}`);
  end('updateFuncsInFile');
  return {structChg, funcItems};
}

////////////////////// getFolderFileChildren //////////////////////

async function getFolderFileChildren(parent: WsAndFolderItem,
                                     folders: Item[], files: Item[]) {
  const parentFsPath = parent.resourceUri!.fsPath;
  const entries = await fs.readdir(parentFsPath, {withFileTypes: true});
  for (const entry of entries) {
    const fsPath    = path.join(parentFsPath, entry.name);
    const uri       = vscode.Uri.file(fsPath);
    if(uri.scheme !== 'file') continue;
    const isDir = entry.isDirectory();
    if(!sett.includeFile(fsPath, isDir)) continue;
    let folderFileItem = ([...itemsById.values()]
        .find(item => (item as FolderItem)
        .resourceUri?.fsPath === fsPath) as FolderItem | FileItem | null);
    if (isDir) {
      if(!folderFileItem) {
        folderFileItem = await FolderItem.create(uri, parent);
        if(!folderFileItem) continue;
      }
      folders.push(folderFileItem);
      continue;
    }
    if (entry.isFile()) {
      if(!folderFileItem) {
        const document = await vscode.workspace.openTextDocument(uri);
        folderFileItem = new FileItem(parent, document);
      }
      files.push(folderFileItem);
      continue;
    }
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
  await getFolderFileChildren(wsFolderItem, folders, files);
  return [...folders, ...files];
}

function loadMarks() {
  const fsPathMarkIdArr: Array<[string, string[]]> =  
          context.workspaceState.get('markIds', []);
  for(const [fsPath, markIds] of fsPathMarkIdArr) {
    let markIdsSet = markIdSetByFspath.get(fsPath);
    if(!markIdsSet) {
      markIdsSet = new Set<string>();
      markIdSetByFspath.set(fsPath, markIdsSet);
    }
    for(const markId of markIds) {
      markIdsSet.add(markId);
    }
  }
}

export async function saveMarks() {
  const fsPathMarkIdArr: Array<[string, string[]]> = [];
  for (const [fsPath, markIdSet] of markIdSetByFspath.entries()) {
    fsPathMarkIdArr.push([fsPath, Array.from(markIdSet)]);
  }
  await context.workspaceState.update('markIds', fsPathMarkIdArr);
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