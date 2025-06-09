import * as vscode from 'vscode';
import {Dirent}    from 'fs';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import * as sbar   from './sidebar';
import * as fnct   from './funcs';
import {Func}      from './funcs';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('sbcl');

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

async function getFsEntries(parentFsPath: string) : Promise<Dirent[]> {
  return await fs.readdir(parentFsPath, {withFileTypes: true});
}

export class WsAndFolderItem extends Item {
  private children: Item[] | undefined;
  private async _getFolderFileChildren(
       parentFsPath: string, folders: Item[], files: Item[]) {
    const entries = await getFsEntries(parentFsPath);
    for (const entry of entries) {
      const fsPath = path.join(parentFsPath, entry.name);
      if (entry.isDirectory()) {
        const uri = vscode.Uri.file(fsPath);
        if(uri.scheme !== 'file' || 
          !sett.includeFile(fsPath, true)) continue;
        let folderItem: FolderItem | null = null;
        try { folderItem = await FolderItem.create(fsPath); }
        catch (err: unknown) { continue; }
        if (folderItem !== null) {
          folderItem.parentId = parentFsPath;
          folders.push(folderItem);
        }
      }
      if (entry.isFile()) {
        const uri = vscode.Uri.file(fsPath);
        if(uri.scheme !== 'file' || 
          !sett.includeFile(fsPath)) continue;
        let fileItem : FileItem;
        try { fileItem = new FileItem(fsPath); }
        catch (err: unknown) { continue; }
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
    if((await getFsEntries(fsPath)).length === 0)
      throw new Error(`Folder is empty.`);
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
    sbar.setItemInMap(this);
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

export class FuncItem extends Item {
  func?:    Func;
  pointer?: boolean;
  constructor(func: Func) {
    const label = (func.marked ? '🔖' : '') + func.name;
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
      // if(this.pointer) this.iconPath = new vscode.ThemeIcon('triangle-right');
    }
    this.command = {
      command: 'vscode-function-explorer.funcClickCmd',
      title:   'Item Clicked',
      arguments: [id],
    };
    sbar.setItemInMap(this);
  }
  setFunc(func: Func) {
    this.func = func;
    sbar.updateTree(this);
  }
}
