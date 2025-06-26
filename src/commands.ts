import * as vscode      from 'vscode';
import * as disp        from './display';
import {FuncItem, Item, itms} from './display';
import * as sett        from './settings';
import {settings}       from './settings';
import * as utils       from './utils';
const {log} = utils.getLog('cmds');

const NEXT_DEBUG = false;
// const NEXT_DEBUG = true;

export async function activate() {
  await editorOrTextChg();
}
export async function toggleCmd() {
  log('toggleCmd');
  let funcItem = await disp.getFuncInAroundSelection();
  if(!funcItem) {
    await prevNext(true, true);
    return;
  }
  await disp.setMark(funcItem, true);
}

export async function toggleItemMarkCmd(funcItem: FuncItem) {
  await disp.setMark(funcItem, true);
}

async function prevNext(next: boolean, setMark = false) {
  let activeEditor = vscode.window.activeTextEditor;
  if(!activeEditor || activeEditor.document.uri.scheme !== 'file' ||
                     !sett.includeFile(activeEditor.document.uri.fsPath)) {
    for(activeEditor of vscode.window.visibleTextEditors) {
      if(activeEditor.document.uri.scheme === 'file' &&
         sett.includeFile(activeEditor.document.uri.fsPath))
      break;
    }
  }
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath)) {
    const fsPath   = activeEditor.document.uri.fsPath;
    const fileWrap = settings.fileWrap && !setMark;
    const filtered = !setMark && !NEXT_DEBUG;
    const funcs = await disp.getSortedFuncs(fsPath, fileWrap, filtered);
    if(funcs.length == 0) return;
    const selFsPath = (fileWrap ? fsPath : '');
    const selKey = utils.createSortKey(
          selFsPath, activeEditor.selection.active.line);
    let func: FuncItem | null = null;
    for(let i = (next? 0 : funcs.length-1); 
                (next? (i < funcs.length) : (i >= 0)); 
           i += (next? 1 : -1)) {
      func = funcs[i];
      const funcFsPath = (fileWrap ? func.getFsPath() : '');
      if(next ? (funcFsPath < selFsPath) 
              : (funcFsPath > selFsPath)) continue;
      if(funcFsPath !== selFsPath) break;
      const funcKey = utils.createSortKey(
                               funcFsPath, func.getStartLine());
      if(next) {
        if(selKey < funcKey) break;
        else if(i == funcs.length-1) {
          if(setMark) return;
          func = funcs[0];
          break;
        }
      }
      else {
        if(selKey > funcKey) break;
        else if(i == 0) {
          if(setMark) return;
          func = funcs[funcs.length-1];
          break;
        }
      }
    }
    if(!func) return;
    await disp.revealFuncInEditor(func);
    if(setMark) await disp.setMark(func, true);
  }
}

export async function prev() { await prevNext(false); }

export async function next() { await prevNext(true); }

export async function funcClickCmd(funcItem: FuncItem) { 
  if (funcItem) {
    // utils.startDelaying('selChg');
    await disp.revealFuncInEditor(funcItem);
  }
}

export async function removeMarks(item: Item) {
  if(item === undefined) {
    vscode.window.showInformationMessage('No item was selected. No function marks were removed.');
    return;
  }
  const funcs = await disp.getFuncItemsUnderNode(item);
  for (const func of funcs) await disp.setMark(func);
}

export async function editorOrTextChg(
                      editor: vscode.TextEditor | undefined = undefined) {
  if(!editor) {
    editor = vscode.window.activeTextEditor;
    if(!editor) return;
  }
  if(editor.document.uri.scheme !== 'file' ||
     !sett.includeFile(editor.document.uri.fsPath)) return;
  const fsPath      = editor.document.uri.fsPath;
  const fileItem    = await disp.getOrMakeFileItemByFsPath(fsPath);
  fileItem.children = null;
  if(fileItem.parent) disp.updateItemInTree(fileItem);
  disp.updateGutter(editor, fileItem);
}

export async function selectionChg(p: vscode.TextEditorSelectionChangeEvent) {
  const {textEditor, selections} = p;
  if (textEditor.document.uri.scheme !== 'file' ||
     !sett.includeFile(textEditor.document.uri.fsPath)) return;
  if(utils.isDelaying('selChg')) return;
  // const document  = textEditor.document;
  // const fsPath    = document.uri.fsPath;
  // const selection = selections[0];
  // const selStart  = document.offsetAt(selection.start);
  // const selEnd    = document.offsetAt(selection.end);
  // const func      = disp.getFuncAtLine(fsPath, selection.start.line);
  // if(func && selStart >= func.start && selEnd <= func.endName) {
  //   await setMark(func, true);
  //   return;
  // }
  utils.startDelaying('selChg');
  await disp.updatePointers();
  sett.enableDidChangeVisible();
  // await prevNext(true, false, true);  
}

export function fileChanged(uri: vscode.Uri) {
}
export function fileCreated(uri: vscode.Uri) {
}
export function fileDeleted(uri: vscode.Uri) {
}

let watcher: vscode.FileSystemWatcher | undefined;

export function setFileWatcher() {
  if (watcher) watcher.dispose();
  watcher = vscode.workspace.createFileSystemWatcher(sett.filesGlobPattern);
  watcher.onDidChange(uri => { fileChanged(uri); });
  watcher.onDidCreate(uri => { fileCreated(uri); });
  watcher.onDidDelete(uri => { fileDeleted(uri); });
}

