import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import * as sett   from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('item');

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
  parent:   Item | null = null;
  children: Item[] = [];
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

export class FileItem extends Item {
  expanded:    boolean;
  filtered:    boolean = false;
  alphaSorted: boolean = false;
  constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.id           = getItemId();
    this.expanded     = false;
    this.key          = fsPath;
    this.iconPath     = new vscode.ThemeIcon('file');
    this.contextValue = 'file';
    sbar.setItemInMap(this);
  }
  async getChildren(): Promise<FuncItem[]> {
    let sortedFuncs = fnct.getSortedFuncs(
                     {fsPath: this.key!, 
                      alpha: this.alphaSorted, filtered: this.filtered});
    if(this.filtered && sortedFuncs.length == 0) {
      this.filtered = false;
      sortedFuncs = fnct.getSortedFuncs(
           {fsPath: this.key!, alpha: this.alphaSorted, filtered: false});
    }
    const funcItems: FuncItem[] = [];
    for(const func of sortedFuncs) {
      if(func.marked || funcIsFunction(func)) {
        const item = await sbar.getOrMakeItemByKey(func.key, func) as FuncItem;
        item.parentId = this.key;
        funcItems.push(item);
      }
    }
    return Promise.all(funcItems);
  }
}

// export class FuncItem extends Item {
//   constructor(func: Func) {
//     super('', vscode.TreeItemCollapsibleState.None);
//     this.id   = getItemId();
//     const key = func.key;
//     this.parentId = func.getFsPath();
//     Object.assign(this, {key, contextValue:'func'});
//     if(func.marked) this.iconPath = new vscode.ThemeIcon('bookmark');
//     this.command = {
//       command: 'vscode-function-explorer.funcClickCmd',
//       title:   'Item Clicked',
//       arguments: [key],
//     };
//     sbar.setItemInMap(this);
//   }
// }
export class FuncItem extends Item {
  declare parent: FileItem;
  funcParents:    FuncItem[] = [];
  document:       vscode.TextDocument;
  name:           string = '';
  type:           string = '';
  start:          number = 0;
  startName:      number = 0;
  endName:        number = 0;
  end:            number = 0;
  marked:         boolean = false;
  funcType:       string = '';
  fsPath?:        string;
  startLine?:     number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  constructor(p:any) {
    super('', vscode.TreeItemCollapsibleState.None);
    this.id       = getItemId();
    this.parent   = p.parent   as FileItem;
    this.document = p.document as vscode.TextDocument;
    this.name     = p.name     as string;
    this.type     = p.type     as string;
    this.start    = p.start    as number;
    this.endName  = p.endName  as number;
    this.end      = p.end      as number;
    this.label    = this.getLabel();
    this.contextValue = 'func';
    this.marked       =  false;
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked'
    };
  }
  getFsPath()      { return this.fsPath    ??= 
                            this.document.uri.fsPath;}
  getStartLine()   { return this.startLine ??= 
                            this.document.positionAt(this.start).line;}
  getEndLine()     { return this.endLine   ??= 
                            this.document.positionAt(this.end).line;}
  getStartKey()    { return this.startKey  ??= utils.createSortKey( 
                            this.getFsPath(), this.getStartLine());      }
  getEndKey()      { return this.endKey    ??= utils.createSortKey(
                            this.getFsPath(), this.getEndLine());        }
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
    }
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