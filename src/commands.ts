import * as vscode      from 'vscode';
import * as disp        from './display';
import {FuncItem, Item, FileItem} from './display';
import * as sett        from './settings';
import {settings}       from './settings';
import * as utils       from './utils';
const {log} = utils.getLog('cmds');

const NEXT_DEBUG = false;
// const NEXT_DEBUG = true;

export async function activate() {
  await editorOrTextChg();
}

// export async function toggleCmd() {
//   log('toggleCmd');
//   let funcItem = await disp.getFuncInAroundSelection();
//   if(!funcItem) {
//     await prevNext(true, true);
//     return;
//   }
//   await disp.setMark(funcItem, true);
// }

export async function toggleCmd() {
  log('toggleCmd');
  let aroundFuncItem = await disp.getFuncInAroundSelection();
  if(!aroundFuncItem) {
    await prevNext(true, true);
    return;
  }
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return;
  const selFsPath = activeEditor.document.uri.fsPath;
  const funcItems = await disp.getSortedFuncs(selFsPath, false, false);
  if(funcItems.length == 0) return;
  const selLine = activeEditor.selection.active.line;
  const nextFuncItem = funcItems.find(item => item.getStartLine() > selLine);
  let funcItemToMark = (nextFuncItem as FuncItem);
  if(!nextFuncItem)
    funcItemToMark = aroundFuncItem;
  else if(nextFuncItem.getStartLine() > aroundFuncItem.getEndLine())
    funcItemToMark = aroundFuncItem;
  else {
    const distFromSelToAround = selLine - aroundFuncItem.getStartLine();
    const distFromSelToNext   = nextFuncItem.getStartLine() - selLine;
    if(distFromSelToAround <= distFromSelToNext)
      funcItemToMark = aroundFuncItem;
  }
  const red = !await disp.setMark(funcItemToMark, true);
  await disp.revealFuncInEditor(funcItemToMark, red);
}

export async function toggleItemMarkCmd(funcItem: FuncItem) {
  const red = !await disp.setMark(funcItem, true);
  await disp.revealFuncInEditor(funcItem, red);
}

async function prevNext(next: boolean, fromToggle = false) {
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
    const fileWrap = settings.fileWrap && !fromToggle;
    const filtered = !fromToggle && !NEXT_DEBUG;
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
      if(funcFsPath !== selFsPath) {
        if(fromToggle) return;
        break;
      }
      const funcKey = utils.createSortKey(
                               funcFsPath, func.getStartLine());
      if(next) {
        if(selKey < funcKey) break;
        else if(i == funcs.length-1) {  
          if(fromToggle) return;
          func = funcs[0];
          break;
        }
      }
      else {
        if(selKey > funcKey) break;
        else if(i == 0) {
          if(fromToggle) return;
          func = funcs[funcs.length-1];
          break;
        }
      }
    }
    if(!func) return;
    if(fromToggle) {
      if(activeEditor.visibleRanges.length > 0) {
        const lastRange = activeEditor
                .visibleRanges[activeEditor.visibleRanges.length - 1];
        const lastVisibleLine = lastRange.end.line;
        if(func.getStartLine() >= lastVisibleLine) return;
      }
    }
    await disp.revealFuncInEditor(func);
    if(fromToggle) await disp.setMark(func, true);
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
  const fsPath = editor.document.uri.fsPath;
  if(editor.document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return;
  const fileItem = await disp.getOrMakeFileItemByFsPath(fsPath);
  // log('editorOrTextChg start', fileItem.label, fileItem.id, 
  //                              fileItem?.children?.length);
  disp.updateFileChildrenFromAst(fileItem);
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
}

export async function openFile(item: Item) {
  if (item === undefined) {
    log('info', 'No file item was selected.');
    return;
  }
  await utils.revealEditorByFspath((item as FileItem).document.uri.fsPath);
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

