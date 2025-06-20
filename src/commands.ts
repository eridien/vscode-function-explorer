import * as vscode  from 'vscode';
import * as sbar    from './sidebar';
import * as fnct    from './funcs';
import {Func}       from './funcs';
import {FuncItem}   from './items';
import * as sett    from './settings';
import {settings}   from './settings';
import * as gutt    from './gutter';
import * as utils   from './utils';
const {log} = utils.getLog('cmds');

const NEXT_DEBUG = false;
// const NEXT_DEBUG = true;

async function setMark(func: Func, toggle = false, mark = false) {
  if(!func) return;
  if (toggle) func.marked = !func.marked;
  else        func.marked = mark;
  const red = !func.marked;
  startselectionChgDelay();
  await sbar.saveFuncAndUpdate(func);
  await sbar.revealItemByFunc(func);
  await fnct.revealFunc(null, func, red);
}

export async function toggleCmd() {
  log('toggleCmd');
  const func = fnct.getBiggestFuncInSelection();
  if(!func) {
    await prevNext(true, true);
    return;
  }
  await setMark(func, true);
}

export async function toggleFuncMarkCmd(funcItem: FuncItem) {
  const func = fnct.getFuncById(funcItem.id);
  if(!func) return;
  await setMark(func, true);
}

async function prevNext(next: boolean, markIt = false, setPointer = false) {
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
    const fileWrap = settings.fileWrap && !markIt && !setPointer;
    const sortArgs = {filtered: !markIt && !setPointer && !NEXT_DEBUG};
    if(!fileWrap) (sortArgs as any).fsPath = fsPath;
    const funcs = fnct.getSortedFuncs(sortArgs);
    if(funcs.length == 0) return;
    const selFsPath = (fileWrap ? fsPath : '');
    const selKey = utils.createSortKey(
          selFsPath, activeEditor.selection.active.line);
    let func: Func | null = null;
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
          if(markIt || setPointer) return;
          func = funcs[0];
          break;
        }
      }
      else {
        if(selKey > funcKey) break;
        else if(i == 0) {
          if(markIt || setPointer) return;
          func = funcs[funcs.length-1];
          break;
        }
      }
    }
    if(markIt && func)          await setMark(func, true);
    else if(setPointer && func) await sbar.setPointer(func);
    else {
      startselectionChgDelay();
      await fnct.revealFunc(null, func);
    }
  }
}

export async function prev() { await prevNext(false); }

export async function next() { await prevNext(true); }

export async function funcClickCmd(id: string) { 
  startselectionChgDelay();
  await sbar.funcClickCmd(id);
}

export async function editorChg(editor: vscode.TextEditor) {
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await fnct.updateFuncsInFile();
  updateSide(document);
}

export async function textChg(event :vscode.TextDocumentChangeEvent) {
  const document = event.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  if (event.contentChanges.length == 0) return;
  await fnct.updateFuncsInFile();
  updateSide(document);
}

let clickselectionChgDelaying = false;

function startselectionChgDelay() {
  clickselectionChgDelaying = true;
  setTimeout(() => { clickselectionChgDelaying = false; }, 500);
}

export async function selectionChg(p: vscode.TextEditorSelectionChangeEvent) {
  const {textEditor, selections} = p;
  if (textEditor.document.uri.scheme !== 'file' ||
     !sett.includeFile(textEditor.document.uri.fsPath)) return;
  if(!clickselectionChgDelaying) {
    const document = textEditor.document;
    const fsPath   = document.uri.fsPath;
    const selection = selections[0];
    const selStart = document.offsetAt(selection.start);
    const selEnd   = document.offsetAt(selection.end);
    const func = fnct.getFuncAtLine(fsPath, selection.start.line);
    if(func && selStart >= func.start && selEnd <= func.endName) {
      await setMark(func, true);
      return;
    }
    startselectionChgDelay();
    if(!await sbar.updatePointers())
      await prevNext(true, false, true);
  }
}

export function updateSide(document?: vscode.TextDocument) {
  if(!document) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) document = activeEditor.document;
  }
  if(!document) return;
  sbar.updateTree();
  gutt.updateGutter();
};
