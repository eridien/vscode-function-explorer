import * as vscode from 'vscode';
import {Dirent}    from 'fs';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as fnct   from './funcs';
import {Func}      from './funcs';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export class Item extends vscode.TreeItem {
  wsFolder?:   vscode.WorkspaceFolder;
  func?:       Func;
  pointer?:    boolean;
  parentId?:   string;

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

class WsAndFolderItem extends Item {
  private children: Item[] | undefined;
  async getFsEntries(parentFsPath: string) : Promise<Dirent[]> {
    return await fs.readdir(parentFsPath, {withFileTypes: true});
  }
  private async _getFolderFileChildren(
       parentFsPath: string, folders: Item[], files: Item[]) {
    const entries = await this.getFsEntries(parentFsPath);
    for (const entry of entries) {
      const fsPath = path.join(parentFsPath, entry.name);
      if (entry.isDirectory()) {
        const uri = vscode.Uri.file(fsPath);
        if(uri.scheme !== 'file' || 
          !sett.includeFile(fsPath, true)) continue;
        const folderItem = await new FolderItem(fsPath);
        if (folderItem !== null) {
          folderItem.parentId = parentFsPath;
          folders.push(folderItem);
        }
      }
      if (entry.isFile()) {
        const uri = vscode.Uri.file(fsPath);
        if(uri.scheme !== 'file' || 
          !sett.includeFile(fsPath)) continue;
        const fileItem = new FileItem(fsPath);
        if(fileItem !== null) {
          fileItem.parentId = parentFsPath;
          files.push(fileItem);
        }
      }
    }
  }
  async getChildren() {
    if(this.children) return this.children;
    const folders: Item[] = [];
    const files:   Item[] = [];
    await this._getFolderFileChildren(this.id, folders, files);
    this.children = [...folders, ...files];
    return this.children;
  }
}

export class WsFolderItem extends WsAndFolderItem {
  async constructor(wsFolder: vscode.WorkspaceFolder) {
    super(wsFolder.name, vscode.TreeItemCollapsibleState.Expanded);
    const id = wsFolder.uri.fsPath;
    const iconPath = new vscode.ThemeIcon('root-folder');
    Object.assign(this, {id, contextValue:'wsFolder', iconPath});
    this.command = {
      command:   'vscode-function-explorer.workspaceFolderClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    setItemInMaps(this);
  }
}

export class FolderItem extends WsAndFolderItem {
  constructor(fsPath: string) {
    super(fsPath);
    const label = path.basename(fsPath);
    if((await this.getFsEntries(fsPath)).length === 0) 
      throw new Error(`Folder "${label}" is empty.`);
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    const id = fsPath;
    const iconPath = new vscode.ThemeIcon('folder');
    Object.assign(this, {id, contextValue:'folder', iconPath});
    this.command = {
      command:   'vscode-function-explorer.folderClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    setItemInMaps(this);
  }
}

class FileItem extends Item {
  private children?: Item[];
  private funcs?:    Func[];
  constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.funcs ??= fnct.getSortedFuncs(
                         {fsPath, alpha:settings.alphaSortFuncs});
    if(this.funcs.length === 0) 
      throw new Error(`File "${this.label}" has no functions.`);
    const id = fsPath;
    const iconPath = new vscode.ThemeIcon('file');
    Object.assign(this, {id, contextValue:'file', iconPath});
    this.command = {
      command:   'vscode-function-explorer.fileClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    setItemInMaps(this);
  }
  getChildren(): Item[] {
    this.children ??= this.funcs!.map(
        func => {const item = new FuncItem(func);
                  item.parentId = this.id;
                  return item;
                });
    return this.children;
  }
}

class FuncItem extends Item {
  constructor(func: fnct.Func) {
    super(func.name, vscode.TreeItemCollapsibleState.None);
    const id = func.id;
    Object.assign(this, {id, contextValue:'func', func});
    if(func.marked) 
      this.iconPath = new vscode.ThemeIcon('bookmark');
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [id],
    };
    setItemInMaps(this);
  }

  const label = (func.marked ? '🔖' : '') + func.name;
  const item = new Item(label, vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id: func.id, contextValue:'func', func});
  const activeEditor = vscode.window.activeTextEditor;
  item.pointer = activeEditor                                  && 
      activeEditor.document.uri.scheme === 'file'              &&
      func.getFsPath()    === activeEditor.document.uri.fsPath &&
      func.getStartLine() === activeEditor.selection.active.line;
  // if(item.pointer) item.iconPath = new vscode.ThemeIcon('triangle-right');
  item.command = {
    command: 'vscode-function-explorer.funcClickCmd',
    title:   'Item Clicked',
    arguments: [item.id],
  };
  setItemInMaps(item);
  return item;
};
