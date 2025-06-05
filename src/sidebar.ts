// @ts-nocheck

import vscode      from 'vscode';
import * as path   from 'path';
import * as mrks   from './marks';
import * as sett   from './settings';
import {settings}  from './settings';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('side');

const showPointers   = true;
let itemTree         = [];
const closedFolders  = new Set();
let   treeView;

export function init(treeViewIn) {
  treeView = treeViewIn;
}

export class SidebarProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  getTreeItem(item) {
    return item;
  }

  async getChildren(item) {
    if (showingBusy) return [];
    if(!item) {
      await mrks.waitForInit();
      return await getItemTree();
    }
    return item.children ?? [];
  }
}

let intervalId  = null;
let timeoutId   = null;
let showingBusy = false;

export function setBusy(busy, blinking = false) {
  if (treeView) 
      treeView.message = busy ? '⟳ Processing Bookmarks ...' : '';
  utils.updateSide();
  if(blinking) return;
  if(busy && !showingBusy) {
    showingBusy = true;
    intervalId = setInterval(() => {
      setBusy(true, true);
      timeoutId = setTimeout(() => { setBusy(false, true); }, 1000);
    }, 2000);
    setBusy(true);
  }
  if(!busy && showingBusy) {
    showingBusy = false;
    clearInterval(intervalId);
    clearTimeout(timeoutId);
    intervalId = null;
    timeoutId  = null;
    setBusy(false, true);
  }
}

let uniqueItemIdNum = 0;
function getUniqueIdStr() { return (++uniqueItemIdNum).toString(); }

function getNewFolderItem(mark, wsFolder) {
  const id        = getUniqueIdStr();
  const label     = '📂 ' +  wsFolder.name;
  const item      = new vscode.TreeItem(
                       label, vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id, type:'folder', contextValue:'folder', label});
  item.command = {
    command:   'vscode-function.itemClickCmd',
    title:     'Item Clicked',
    arguments: [item],
  };
  if(!mark) {
    item.iconPath = new vscode.ThemeIcon("chevron-down");
    item.wsFolder = wsFolder;
    return item;
  }
  item.mark     = mark;
  item.wsFolder = mark.getWsFolder();
  if(closedFolders.has(mark.getWsFolder().uri.fsPath))
    item.iconPath = new vscode.ThemeIcon("chevron-right");
  else
    item.iconPath = new vscode.ThemeIcon("chevron-down");
  return item;
}     

function getNewFileItem(mark, children) { 
  const relPath = path.relative(mark.getWsFolder().uri.fsPath, 
                                mark.getFsPath());
  const label =  '📄 ' + relPath;
  const item  = new vscode.TreeItem(label,
                    vscode.TreeItemCollapsibleState.Expanded);
  item.id = getUniqueIdStr();
  Object.assign(item, {type:'file', contextValue:'file', children, mark});
  item.command = {
    command:   'vscode-function.itemClickCmd',
    title:     'Item Clicked',
    arguments: [item],
  };
  return item;
};

function getNewMarkItem(mark) {
  const item = new vscode.TreeItem(mark.name,
                   vscode.TreeItemCollapsibleState.None);
  Object.assign(item, {id:getUniqueIdStr(), type:'mark', 
                       contextValue:'mark', mark});
  item.command = {
    command: 'vscode-function.itemClickCmd',
    title:   'Item Clicked',
    arguments: [item],
  };
  return item;
};

let logIdx = 0;

async function getItemTree() {
  start('getItemTree', true);
  // log('getItemTree', logIdx++);
  const allWsFolders = vscode.workspace.workspaceFolders;
  if (!allWsFolders) {
    log('err', 'getItemTree, No folders in workspace');
    return [];
  }
  const rootItems   = [];
  const marksArray  = mrks.getSortedMarks({enabledOnly:false});
  let marks;
  let lastFldrFsPath = null, lastFileFsPath;
  for(const mark of marksArray) {
    const fldrFsPath = mark.getWsFolder().uri.fsPath;
    if(closedFolders.has(mark.getFsPath())) continue;
    if(!await utils.fileExists(fldrFsPath)) {
      log('err','Folder not in the workspace:', fldrFsPath);
      continue;
    } 
    if(fldrFsPath !== lastFldrFsPath) {
      lastFldrFsPath = fldrFsPath;
      let wsFolder = null;
      while(wsFolder = allWsFolders.shift()) {
        rootItems.push(getNewFolderItem(mark, wsFolder));
        if(wsFolder.uri.fsPath === fldrFsPath) break;
      }
      if(!wsFolder) { 
        log('err', 'Folder missing: ', fldrFsPath);
        continue;
      }
      lastFileFsPath = null;
    }
    if(mark.fileFsPath() !== lastFileFsPath) {
      lastFileFsPath = mark.getFsPath();
      marks = [];
      rootItems.push(getNewFileItem(mark, marks));
    }
    marks.push(getNewMarkItem(mark));
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const document     = editor.document;
    const editorFsPath = document.uri.fsPath;
    const editorLine   = editor.selection.active.line;
    if(showPointers) {
      let itemMatch = null;
      itemLoop:
      for(const item of rootItems) {
        const fldrFsPath = item.mark.getWsFolder().uri.fsPath;
        if(item.type === 'file' &&
           item.mark.getFsPath() === editorFsPath &&
           item.children && item.children.length > 0   &&
           !closedFolders.has(fldrFsPath)) {
          for (const childItem of item.children) {
            const markLine = childItem.mark.getStartLine();
            if(editorLine === markLine) {
              itemMatch = childItem;
              break itemLoop;
            }
          }
        }
      }
      if(itemMatch) 
         itemMatch.iconPath = new vscode.ThemeIcon("triangle-right");
    }
  }
  let wsFolder = allWsFolders.shift();
  while(wsFolder) {
    rootItems.push(getNewFolderItem(null, wsFolder));
    wsFolder = allWsFolders.shift();
  }
  itemTree = rootItems;
  end('getItemTree');
  return itemTree;
}

export function toggleFolder(item, forceClose = false, forceOpen = false) {
  log('toggleFolder');
  if(item.wsFolder) closedFolders.delete(item.wsFolder.uri.fsPath);
  else {
    const wsFldrFsPath = item.mark.getWsFolder().uri.fsPath;
    const open = forceOpen || (!forceClose && closedFolders.has(wsFldrFsPath));
    if(open) closedFolders.delete(wsFldrFsPath);
    else     closedFolders.add(wsFldrFsPath);
  }
  utils.updateSide();
}

export async function itemClick(item) {
  log('itemClick');
  if(item === undefined) {
    item = treeView.selection[0];
    if (!item) { log('info err', 'No Bookmark Selected'); return; }
  }
  // text.clearDecoration();
  switch(item.type) {
    case 'folder': toggleFolder(item); break;
    case 'file':
      await vscode.window.showTextDocument(
                               item.mark.document, {preview: false});
      break;
    case 'mark': mrks.markItemClick(item); break;
  }
}
