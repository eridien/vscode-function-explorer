import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import {Func}      from './funcs';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('item');

let context: vscode.ExtensionContext;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
}

export class Item extends vscode.TreeItem {
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

export class WsAndFolderItem extends Item {
  private children: Item[] | undefined;
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
        const folderItem = await FolderItem.create(fsPath);
        if(!folderItem) continue;
        folderItem.parentId = parentFsPath;
        folders.push(folderItem);
      }
      if (entry.isFile()) {
        const fileItem = new FileItem(fsPath);
        if(!fileItem) continue;
        fileItem.parentId = parentFsPath;
        files.push(fileItem);
      }
    }
  }
  async getChildren() {
    if(this.children) return this.children;
    const folders: Item[] = [];
    const files:   Item[] = [];
    await this._getFolderFileChildren(this.id!, folders, files);
    this.children = [...folders, ...files];
    return this.children;
  }
}

export class WsFolderItem extends WsAndFolderItem {
  constructor(wsFolder: vscode.WorkspaceFolder) {
    super(wsFolder.name, vscode.TreeItemCollapsibleState.Expanded);
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
  private constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Collapsed);
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

class FileItem extends Item {
  private children?: Item[];
  constructor(fsPath: string) {
    super(path.basename(fsPath), vscode.TreeItemCollapsibleState.Collapsed);
    const id = fsPath;
    const iconPath = new vscode.ThemeIcon('file');
    Object.assign(this, {id, contextValue:'file', iconPath});
    this.command = {
      command:   'vscode-function-explorer.fileClickCmd',
      title:     'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
  async getChildren(): Promise<Item[]> {
    if(this.children) return this.children;
    const uri = vscode.Uri.file(this.id!);
    const document = await vscode.workspace.openTextDocument(uri);
    await  fnct.updateFuncsInFile(document);
    return fnct.getSortedFuncs(
        {fsPath: this.id!, alpha:settings.alphaSortFuncs})
        .map(func => {const item = new FuncItem(func);
                      item.parentId = this.id;
                      return item;
                     });
  }
}

export class FuncItem extends Item {
  func?:    Func;
  pointer?: boolean;
  constructor(func: Func) {
    const label = (func.marked ? '🞂' : ' ') + func.name;
    super(label, vscode.TreeItemCollapsibleState.None);
    const id = func.id;
    Object.assign(this, {id, contextValue:'func', func});
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) {
      let topLine = activeEditor.selection.active.line;
      let botLine = activeEditor.selection.anchor.line;
      if(topLine > botLine) [topLine, botLine] = [botLine, topLine];
      this.pointer = activeEditor                               && 
          activeEditor.document.uri.scheme === 'file'           &&
          func.getFsPath() === activeEditor.document.uri.fsPath &&
          func.getStartLine() <= topLine                        &&
          func.getEndLine()   >= botLine;
      if(func.marked) this.iconPath = new vscode.ThemeIcon('bookmark');
      else            this.iconPath = vscode.Uri.file(
         path.join(context.extensionPath, 'images', 'gutter-icon-lgt.svg'));
    }
    sbar.setMarkInItem(this, func.marked);
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
}
