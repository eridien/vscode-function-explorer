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

// const LOAD_FUNCS_ON_START = true;
const LOAD_FUNCS_ON_START = false;


let nextItemId = 0;
function getItemId() { return '' + nextItemId++; }

let context:          vscode.ExtensionContext;
let funcItemsByFuncId: Map<string, Func> = new Map();

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate items');
  context = contextIn;
  await loadFuncStorage();
  await updateFuncsInFile();
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
    while(this.parent) {
      parents.push(this.parent);
      this.parent = this.parent.parent;
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
    else return await getFuncItemsFromFileAst(this, this.document);
  };
}

async function getFuncItemsFromFileAst(parent: FileItem | WsFolderItem, 
                      document: vscode.TextDocument): Promise<FuncItem[]> {
  start('getFuncItemsFromFileAst');
  const uri = document.uri;
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
  let funcItems: FuncItem[] = [];
  function addFunc(name: string, type: string, 
                   start: number, endName: number, end: number) {
    funcItems.push(new FuncItem({this, name, type, start, endName, end}));
  }
  walk.ancestor(ast, {
    Property(node){
      const {start, end, key} = node;
      const endName = key.end;
      const name = docText.slice(start, endName);
      const type = 'Property';
      addFunc(name, type, start, endName, end);
    },
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init) {
        const endName = id.end!;
        const name = docText.slice(start, endName);
        const type  = 'VariableDeclarator';
        addFunc(name, type, start, endName, end);
      }
      return;
    },
    FunctionDeclaration(node) {
      const start   = node.id!.start;
      const endName = node.id!.end;
      const end     = node.end;
      const name    = docText.slice(start, endName);
      const type    = 'FunctionDeclaration';
      addFunc(name, type, start, endName, end);
      return;
    },
    Class(node) {
      if(!node.id) return;
      const {id, start, end, type} = node;
      const endName = id.end;
      const name    = id.name;
      addFunc(name, type, start, endName, end);
      return;
    },
    MethodDefinition(node) {
      const {start, end, key, kind} = node;
      const endName = key.end;
      if(kind      == 'constructor') {
        const name  = 'constructor';
        const type  = 'Constructor';
        addFunc(name, type, start, endName, end);
        return;
      }
      else {
        const name = docText.slice(start, endName);
        const type = 'Method';
        addFunc(name, type, start, endName, end);
        return;
      }
    }
  });
  const newFuncs = funcs.sort((a, b) => a.start - b.start);
  for(const newFunc of newFuncs) {
    const parents: Func[] = [];
    for(const innerFunc of newFuncs) {
      if(innerFunc === newFunc) continue;
      if(innerFunc.start > newFunc.start) break;
      if(innerFunc.end  >= newFunc.end) parents.unshift(innerFunc);
    }
    newFunc.parents = parents;
    let key = newFunc.name  + "\x00" + newFunc.type   + "\x00";
    for(let parent of parents) 
      key += parent.name + "\x00" + parent.type + "\x00";
    key += newFunc.getFsPath();
    newFunc.key = key;
  }
  const oldFuncs = getFuncs({fsPath: uri.fsPath, deleteFuncsBykey: true});
  let matchCount = 0;
  for(const newFunc of newFuncs) {
    funcItemsByFuncId.set(newFunc.key, newFunc);
    for(const oldFunc of oldFuncs) {
      if(newFunc.key === oldFunc.key) {
        newFunc.marked = oldFunc.marked;
        matchCount++;
        break;
      }
    }
  }
  await saveFuncStorage();
  console.log(`updated funcs in ${path.basename(uri.fsPath)}, `+
                      `marks copied: ${matchCount} of ${funcs.length}`);
  end('updateFuncsInFile');
  return funcItems;;
  
}

////////////////// FuncItem //////////////////////

export class FuncItem extends Item {
  declare parent: FileItem;
  funcParents:    FuncItem[] = [];
  name:           string = '';
  type:           string = '';
  start:          number = 0;
  startName:      number = 0;
  endName:        number = 0;
  end:            number = 0;
  marked:         boolean = false;
  funcType:       string = '';
  startLine?:     number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  constructor({ parent, name, type, start, endName, end }: 
              { parent: FileItem; name: string; type: string; 
                start: number; endName: number; end: number; }) { 
    super('', vscode.TreeItemCollapsibleState.None);
    this.id           = getItemId();
    this.parent       = parent;
    this.name         = name;
    this.type         = type;
    this.start        = start;
    this.endName      = endName;
    this.end          = end;
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
                        (this.parent.document.uri.fsPath, this.getEndLine())};
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

// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/
// https://github.com/estree/estree/blob/master/es5.md
// https://hexdocs.pm/estree/api-reference.html
/*
ClassExpression
YieldExpression
*/