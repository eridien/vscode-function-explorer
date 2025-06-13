import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import {Func}      from './funcs';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
import { getOrMakeItemById } from './sidebar';
const {log} = utils.getLog('item');

let context: vscode.ExtensionContext;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
}

export class Item extends vscode.TreeItem {
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
  expanded: boolean;
  constructor(wsFolder: vscode.WorkspaceFolder) {
    super(wsFolder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.expanded = true;
    this.wsFolder = wsFolder;
    const id = wsFolder.uri.fsPath;
    const iconPath = new vscode.ThemeIcon('root-folder');
    Object.assign(this, {id, contextValue:'wsFolder', iconPath});
    this.command = {
      command:   'vscode-function-explorer.workspaceFolderClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
}

export class FolderItem extends WsAndFolderItem {
  expanded: boolean;
  private constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.expanded = true;
  }
  static async create(fsPath: string) {
    if (!await utils.hasChildTest(fsPath, sett.includeFile)) return null;
    const id = fsPath;
    const iconPath = new vscode.ThemeIcon('folder');
    const command =  {
      command:   'vscode-function-explorer.folderClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    const newThis = new FolderItem(fsPath);
    Object.assign(newThis, {id, contextValue:'folder', iconPath, command});
    sbar.setItemInMap(newThis);
    return newThis;
  }
}

export class FileItem extends Item {
  expanded: boolean;
  constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.expanded     = false;
    this.id           = fsPath;
    this.iconPath     = new vscode.ThemeIcon('file');
    this.contextValue = 'file';
    this.command = {
      command:   'vscode-function-explorer.fileClickCmd',
      title:     'Item Clicked',
      arguments: [fsPath],
    };
    sbar.setItemInMap(this);
  }
  async getChildren(): Promise<FuncItem[]> {
    const uri = vscode.Uri.file(this.id!);
    const document = await vscode.workspace.openTextDocument(uri);
    await fnct.updateFuncsInFile(document);
    const funcItems = fnct.getSortedFuncs(
            {fsPath: this.id!, alpha:settings.alphaSortFuncs,
             markedOnly: sbar.isMarksOnly(this.id!)})
      .map(async func => {
        const item = 
                await sbar.getOrMakeItemById(func.id!, func) as FuncItem;
        item.parentId = this.id;
        return item;
      });
    return Promise.all(funcItems);
  }
}

export class FuncItem extends Item {
  func: Func;
  constructor(func: Func) {
    super(func.name, vscode.TreeItemCollapsibleState.None);
    const id = func.id;
    Object.assign(this, {id, contextValue:'func'});
    this.func = func;
    if(func.marked) this.iconPath = new vscode.ThemeIcon('bookmark');
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
}
