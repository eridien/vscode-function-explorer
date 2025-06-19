import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import {Func}      from './funcs';
import * as sett   from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('item');

export class Item extends vscode.TreeItem {
  id = '';
  parentId?: string;
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
                  await sbar.getOrMakeItemById(fsPath, 'folder') as FolderItem;
        if(!folderItem) continue;
        folderItem.parentId = parentFsPath;
        folders.push(folderItem);
        continue;
      }
      if (entry.isFile()) {
        const fileItem = 
                 await sbar.getOrMakeItemById(fsPath, 'file') as FileItem;
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
    await this._getFolderFileChildren(this.id!, folders, files);
    return [...folders, ...files];
  }
}

export class WsFolderItem extends WsAndFolderItem {
  wsFolder: vscode.WorkspaceFolder;
  constructor(wsFolder: vscode.WorkspaceFolder) {
    super(wsFolder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.expanded = true;
    this.wsFolder = wsFolder;
    const id = wsFolder.uri.fsPath;
    const iconPath = new vscode.ThemeIcon('root-folder');
    Object.assign(this, {id, contextValue:'wsFolder', iconPath});
    sbar.setItemInMap(this);
  }
}

export class FolderItem extends WsAndFolderItem {
  private constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.expanded = true;
  }
  static async create(fsPath: string) {
    if (!await sbar.hasChildFuncTest(fsPath)) return null;
    const id = fsPath;
    const iconPath = new vscode.ThemeIcon('folder');
    const newThis = new FolderItem(fsPath);
    Object.assign(newThis, {id, contextValue:'folder', iconPath});
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
    this.expanded     = false;
    this.id           = fsPath;
    this.iconPath     = new vscode.ThemeIcon('file');
    this.contextValue = 'file';
    sbar.setItemInMap(this);
  }
  async getChildren(): Promise<FuncItem[]> {
    let sortedFuncs = fnct.getSortedFuncs(
                     {fsPath: this.id!, 
                      alpha: this.alphaSorted, filtered: this.filtered});
    if(this.filtered && sortedFuncs.length == 0) {
      this.filtered = false;
      sortedFuncs = fnct.getSortedFuncs(
           {fsPath: this.id!, alpha: this.alphaSorted, filtered: false});
    }
    const funcItems: FuncItem[] = [];
    for(const func of sortedFuncs) {
      if(func.marked || funcIsFunction(func)) {
        const item = await sbar.getOrMakeItemById(func.id, func) as FuncItem;
        item.parentId = this.id;
        funcItems.push(item);
      }
    }
    return Promise.all(funcItems);
  }
}

function funcIsFunction(func: Func): boolean {
  return ['FunctionDeclaration', 'FunctionExpression',
          'ArrowFunctionExpression', 'MethodDefinition',
          'Constructor', 'Method']
          .includes(func.type);
}
export function getFuncItemLabel(func: Func): string {
  let label = '  ';
  function addParent(funcParent: Func) {
    if(funcIsFunction(funcParent)) {
      label += ` ƒ ${funcParent.name}`;
      return;
    }
    let pfx: string;
    switch (funcParent.type) {
      case 'Property':            pfx = ':'; break;
      case 'CallExpression':      pfx = '('; break;
      case 'ClassDeclaration':
      case 'ClassExpression':     pfx = '©'; break;
      default:                    pfx = '='; break;
    }
    label += ` ${pfx} ${funcParent.name}`;
  }
  addParent(func);
  for(const funcParent of func.parents!) addParent(funcParent);
  // label += ` (${func.type})`;
  return label.slice(funcIsFunction(func) ? 5 : 3);
}

export class FuncItem extends Item {
  constructor(func: Func) {
    super(getFuncItemLabel(func), vscode.TreeItemCollapsibleState.None);
    const id = func.id;
    this.parentId = func.getFsPath();
    Object.assign(this, {id, contextValue:'func'});
    if(func.marked) this.iconPath = new vscode.ThemeIcon('bookmark');
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
}
