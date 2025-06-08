import * as vscode  from 'vscode';
import * as sbar    from './sidebar';
import * as gutt    from './gutter';
import * as fnct    from './funcs';
import * as sett    from './settings';
import {settings}   from './settings';
import {Func, Item} from './classes';
import * as utils   from './utils';
const {log} = utils.getLog('cmds');

export async function activate() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath))
    await updateSide();
}

export async function toggle() {
  log('toggle');
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const document = editor.document;
  await fnct.updateFuncsInFile(document);
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  let mark:        boolean | null = null;
  let firstFunc:     Func    | null = null;
  let minFuncStart = Number.MAX_SAFE_INTEGER;
  for (const selection of editor.selections) {
    let topLine = selection.active.line;
    let botLine = selection.anchor.line;
    let funcs: Func[] = [];
    const fsPath = document.uri.fsPath;
    if(topLine === botLine) {
      const func = fnct.getFuncAtLine(fsPath, topLine);
      if(func) funcs = [func];
    }
    else {
      if(topLine > botLine) [topLine, botLine] = [botLine, topLine];
      funcs = fnct.getFuncsBetweenLines(fsPath, topLine, botLine, true);
    }
    if(funcs.length === 0) return;
    if(mark === null) {
      let markedCount = 0;
      funcs.forEach(func => { if(func.marked) markedCount++; });
      mark = markedCount/funcs.length < 0.5;
    }
    funcs.forEach(func => {
      func.marked = !func.marked;
      if(mark && func.start < minFuncStart) {
        minFuncStart = func.start;
        firstFunc    = func;
      }
    });
  }
  await updateSide({dontUpdateFuncs: true});
  await fnct.saveFuncStorage();
  if(firstFunc) await fnct.revealFunc(null, firstFunc);
}

async function prevNext(next: boolean) {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath)) {
    const fsPath   = activeEditor.document.uri.fsPath;
    const fileWrap = settings.fileWrap;
    const sortArgs = {markedOnly: true};
    if(!fileWrap) (sortArgs as any).fsPath = fsPath;
    const funcs = fnct.getSortedFuncs(sortArgs);
    if(funcs.length == 0) return;
    const selFsPath = (fileWrap ? fsPath : '');
    const selKey = utils.createSortKey(
          selFsPath, activeEditor.selection.active.line);
    let func: Func;
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
          func = funcs[0];
          break;
        }
      }
      else {
        if(selKey > funcKey) break;
        else if(i == 0) {
          func = funcs[funcs.length-1];
          break;
        }
      }
    }
    await fnct.revealFunc(null, func!, true);
  }
}

export async function prev() { await prevNext(false); }

export async function next() { await prevNext(true); }

export async function editorChg(editor: vscode.TextEditor) {
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await updateSide();
}

export function chgEditorSel(event: vscode.TextEditorSelectionChangeEvent) {
  sbar.updatePointers(event.textEditor);
}

export async function textChg(event :vscode.TextDocumentChangeEvent) {
  const document = event.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await updateSide({document});
}

export async function updateSide( p:any = {}) {
  const {dontUpdateFuncs = false, document} = p;
  if(!dontUpdateFuncs) {
    const updatedFuncs = await fnct.updateFuncsInFile(document);
    sbar.updateItemsFromFuncs(updatedFuncs);
  }
  sbar.updatePointers(null, true);
  sbar.updateTree();
  gutt.updateGutter();
};
