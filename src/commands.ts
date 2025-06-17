import * as vscode  from 'vscode';
import * as sbar    from './sidebar';
import * as fnct    from './funcs';
import {Func}       from './funcs';
import * as sett    from './settings';
import {settings}   from './settings';
import * as gutt    from './gutter';
import * as utils   from './utils';
const {log} = utils.getLog('cmds');

async function setMarks(funcs: Func[], 
                        toggle = false, mark = false) {
  let firstFunc: Func | null = null;
  for (const func of funcs) {
    if (toggle) func.marked = !func.marked;
    else        func.marked = mark;
    if (func.marked) firstFunc ??= func;
    await sbar.saveFuncAndUpdate(func);
    await sbar.revealItemByFunc(func);
  }
  if (firstFunc) {
    await sbar.revealItemByFunc(firstFunc);
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor)
      utils.flashRange(activeEditor,
        (firstFunc as Func).getStartPos(),
        (firstFunc as Func).getEndPos());
  }
}

export async function toggleCmd() {
  log('toggleCmd');
  const funcs = fnct.getFuncsOverlappingSelections();
  if(funcs.length === 0) return;
  let markedCount = 0;
  funcs.forEach(func => { if(func.marked) markedCount++; });
  const mark = markedCount/funcs.length < 0.5;
  await setMarks(funcs, false, mark);
}

async function prevNext(next: boolean) {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath)) {
    const fsPath   = activeEditor.document.uri.fsPath;
    const fileWrap = settings.fileWrap;
    const sortArgs = {filtered: true};
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
  await fnct.updateFuncsInFile();
  updateSide(document);
}

export async function textChg(event :vscode.TextDocumentChangeEvent) {
  const document = event.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await fnct.updateFuncsInFile();
  updateSide(document);
}

let clickDelaying = false;

export async function selectionChg(p: vscode.TextEditorSelectionChangeEvent) {
  const {textEditor, selections, kind} = p;
  if (textEditor.document.uri.scheme !== 'file' ||
     !sett.includeFile(textEditor.document.uri.fsPath)) return;
  const document = textEditor.document;
  const fsPath   = document.uri.fsPath;
  if(!clickDelaying) {
    const funcs: Func[] = [];
    for(const selection of selections) {
      const func = fnct.getFuncAtLine(fsPath, selection.start.line);
      if(func && document.offsetAt(selection.start) >= func.start &&
                document.offsetAt(selection.end)    <= func.endName) {
        funcs.push(func);
      }
      clickDelaying = true;
      setTimeout(() => { clickDelaying = false; }, 500);
    }
    await setMarks(funcs, true);
  }
  await sbar.updatePointers();
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
