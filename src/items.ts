import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as acorn  from "acorn-loose";
import * as walk   from 'acorn-walk';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import * as sett   from './settings';
import * as utils  from './utils';
const {log, start, end} = utils.getLog('item');

let nextItemId = 0;
function getItemId() { return '' + nextItemId++; }

let   context:           vscode.ExtensionContext;
let   funcItemsByFuncId: Map<string, FuncItem> = new Map();
const markIdSetByFspath: Map<string, Set<string>> = new Map<string, Set<string>>();

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate items');
  context = contextIn;
  loadMarks();
  await getFuncItemsFromFileAst();
  end('activate items', false);
}

export class Item extends vscode.TreeItem {
  parent:   Item   | null = null;
  children: Item[] | null = null;
  static getTree() {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
      log('err', 'getTree, No folders in workspace');
      return [];
    }
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) 
      tree.push(new WsFolderItem(wsFolder));
    return tree;
  }
  getParents() {
    const parents: Item[] = [];
    let parent = this.parent;
    while(parent) {
      parents.push(parent);
      parent = parent.parent;
    }
    return parents;
  }
}

export class WsAndFolderItem extends Item {
  expanded: boolean = false;
  private async _getFolderFileChildren(
       parentFsPath: string, folders: Item[], files: Item[]) {
    const entries = await fs.readdir(parentFsPath, {withFileTypes: true});
    for (const entry of entries) {
      const fsPath = path.join(parentFsPath, entry.name);
      const uri    = vscode.Uri.file(fsPath);
      if(uri.scheme !== 'file') continue;
      const isDir = entry.isDirectory();
      if(!sett.includeFile(fsPath, isDir)) continue;
      if (isDir) {
        const folderItem = 
                  await sbar.getOrMakeItemByKey(fsPath, 'folder') as FolderItem;
        if(!folderItem) continue;
        folderItem.parentId = parentFsPath;
        folders.push(folderItem);
        continue;
      }
      if (entry.isFile()) {
        const fileItem = 
                 await sbar.getOrMakeItemByKey(fsPath, 'file') as FileItem;
        if(!fileItem) continue;
        fileItem.parentId = parentFsPath;
        files.push(fileItem);
        continue;
      }
    }
  }
  async getChildren() {
    const folders: Item[] = [];
    const files:   Item[] = [];
    await this._getFolderFileChildren(this.key!, folders, files);
    return [...folders, ...files];
  }
}

export class WsFolderItem extends WsAndFolderItem {
  wsFolder: vscode.WorkspaceFolder;
  constructor(wsFolder: vscode.WorkspaceFolder) {

    super(wsFolder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id       = getItemId();
    this.expanded = true;
    this.wsFolder = wsFolder;
    const key = wsFolder.uri.fsPath;
    const iconPath = new vscode.ThemeIcon('root-folder');
    Object.assign(this, {key, contextValue:'wsFolder', iconPath});
    sbar.setItemInMap(this);
  }
}

export class FolderItem extends WsAndFolderItem {
  private constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.expanded = true;
    this.id       = getItemId();
  }
  static async create(fsPath: string) {
    if (!await sbar.hasChildFuncTest(fsPath)) return null;
    const key = fsPath;
    const iconPath = new vscode.ThemeIcon('folder');
    const newThis = new FolderItem(fsPath);
    Object.assign(newThis, {key, contextValue:'folder', iconPath});
    sbar.setItemInMap(newThis);
    return newThis;
  }
}

////////////////////// FileItem //////////////////////

export class FileItem extends Item {
  declare parent: FolderItem | WsFolderItem;
  document:       vscode.TextDocument;
  expanded:       boolean = false;;
  filtered:       boolean = false;
  alphaSorted:    boolean = false;
  constructor(parent: vscode.TextDocument, document: vscode.TextDocument) {
    const uri = document.uri;
    super(uri, vscode.TreeItemCollapsibleState.Collapsed);
    this.document     = document;
    this.resourceUri  = uri;
    this.id           = getItemId();
    this.contextValue = 'file';
  }
  async getChildren(): Promise<FuncItem[]> {
    if(this.children) return this.children as FuncItem[];
    else {
      let funcItems = await getFuncItemsFromFileAst(this);
      if(this.filtered) funcItems = funcItems.filter(func => func.marked);
      if(this.alphaSorted) 
        funcItems.sort((a, b) => a.name.localeCompare(b.name));
      this.children = funcItems;
      return funcItems;
    }
  };
}
///////////////// getFuncItemsFromFileAst //////////////////////

interface NodeData {
  id?: string;
  name: string;
  type: string;
  start: number;
  endName: number;
  end: number;
}

async function getFuncItemsFromFileAst(parent: FileItem): Promise<FuncItem[]> {
  start('getFuncItemsFromFileAst');
  const document = parent.document;
  const uri      = document.uri;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return [];
  const docText = document.getText();
  if (!docText || docText.length === 0) return [];
  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return[];
  }
  let nodeData: NodeData[] = [];
  walk.ancestor(ast, {
    Property(node){
      const {start, end, key} = node;
      const endName = key.end;
      const name = docText.slice(start, endName);
      const type = 'Property';
      nodeData.push({name, type, start, endName, end});
    },
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init) {
        const endName = id.end!;
        const name = docText.slice(start, endName);
        const type  = 'VariableDeclarator';
        nodeData.push({name, type, start, endName, end});
      }
      return;
    },
    FunctionDeclaration(node) {
      const start   = node.id!.start;
      const endName = node.id!.end;
      const end     = node.end;
      const name    = docText.slice(start, endName);
      const type    = 'FunctionDeclaration';
      nodeData.push({name, type, start, endName, end});
      return;
    },
    Class(node) {
      if(!node.id) return;
      const {id, start, end, type} = node;
      const endName = id.end;
      const name    = id.name;
      nodeData.push({name, type, start, endName, end});
      return;
    },
    MethodDefinition(node) {
      const {start, end, key, kind} = node;
      const endName = key.end;
      if(kind      == 'constructor') {
        const name  = 'constructor';
        const type  = 'Constructor';
        nodeData.push({name, type, start, endName, end});
        return;
      }
      else {
        const name = docText.slice(start, endName);
        const type = 'Method';
        nodeData.push({name, type, start, endName, end});
        return;
      }
    }
  });

  nodeData.sort((a, b) => a.start - b.start);
  for(const node of nodeData) {
    const parents: NodeData[] = [];
    for(const innerNode of nodeData) {
      if(innerNode === node) continue;
      if(innerNode.start > node.start) break;
      if(innerNode.end  >= node.end) parents.unshift(innerNode);
    }
    let id = node.name  + "\x00" + node.type   + "\x00";
    for(let parent of parents) 
      id += parent.name + "\x00" + parent.type + "\x00";
    id += parent.document.uri.fsPath;
    node.id = id;
  }
  let matchCount = 0;
  const funcItems: FuncItem[] = [];
  const oldFuncItemsByFuncId = new Map(funcItemsByFuncId);
  funcItemsByFuncId.clear();
  for(const node of nodeData) {
    let funcItem = oldFuncItemsByFuncId.get(node.id!);
    if(funcItem) {
      funcItem.start    = node.start;
      funcItem.endName  = node.endName;
      funcItem.end      = node.end;
      funcItem.parent   = parent;
      matchCount++;
    }
    else {
      funcItem = new FuncItem({
        parent, name: node.name, type: node.type,
        start: node.start, endName: node.endName, end: node.end
      });
    }
    funcItems.push(funcItem);
    funcItemsByFuncId.set(funcItem.id, funcItem);
  }
  await saveMarks();
  console.log(`updated funcs in ${path.basename(uri.fsPath)}, `+
                      `marks copied: ${matchCount} of ${nodeData.length}`);
  end('updateFuncsInFile');
  // Return the correct FuncItem array (if you have a variable for it, use that)
  // If not, return an empty array or the correct one as needed
  return [];
  
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
    this.id           = getItemId();
    this.label        = this.getLabel();
    this.contextValue = 'func';
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
  getLabel() {
    let label = '  ';
    const addParentToLabel = (parent: FuncItem = this) => {
      if(parent.isFunction(parent)) {
        label += ` ƒ ${this.name}`;
        return;
      }
      let pfx: string;
      switch (this.type) {
        case 'Property':            pfx = ':'; break;
        case 'CallExpression':      pfx = '('; break;
        case 'ClassDeclaration':
        case 'ClassExpression':     pfx = '©'; break;
        default:                    pfx = '='; break;
      }
      label += ` ${pfx} ${this.name}`;
    };
    addParentToLabel();
    const parents = this.funcParents;
    for(const funcParent of parents) addParentToLabel(funcParent);
    // label += ` (${this.type})`;
    return label.slice(this.isFunction() ? 5 : 3);
  }
}

function loadMarks() {
  const fsPathMarkIdArr: Array<Array<string>> =  
          context.workspaceState.get('markIds', []);
  for(const fsPathMarkId of fsPathMarkIdArr) {
    const [fsPath, markId] = fsPathMarkId;
    let markIdsSet = markIdSetByFspath.get(fsPath);
    if(!markIdsSet) {
      markIdsSet = new Set<string>();
      markIdSetByFspath.set(fsPath, markIdsSet);
    }
    markIdsSet.add(markId);
  }
}

export async function saveMarks() {
  const markedItems = [...funcItemsByFuncId.values()]
                     .filter(funcItem => funcItem.marked);
  const fsPathMarkIdArr: Array<Array<string>> = [];
  for(const funcItem of markedItems) {
    const fspath = funcItem.parent.document.uri.fsPath;
    fsPathMarkIdArr.push([fspath, funcItem.funcId]);
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