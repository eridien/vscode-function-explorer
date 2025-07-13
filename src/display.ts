import * as vscode     from 'vscode';
import * as path       from 'path';
import * as itmc       from './item-classes';
import {WsAndFolderItem, FileItem, FuncItem} from './item-classes';
import * as sbar       from './sidebar';
import * as sett       from './settings';
import {settings}      from './settings';
import * as utils      from './utils';
import {itms, mrks, fils} from './dbs';
const {log, start, end} = utils.getLog('disp');

// const CLEAR_MARKS_ON_STARTUP = false; 
const CLEAR_MARKS_ON_STARTUP = true; 

let context: vscode.ExtensionContext;

export function activate(contextIn:  vscode.ExtensionContext) {
  context = contextIn;
  initGutter();
  itmc.setDisp(pointerItems);
}             

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!(item instanceof FileItem)) return;
  if(!expanded) {
    const funcItems = await itmc.getFuncItemsUnderNode(item);
    let filesChanged = new Set<FileItem>();
    let haveMark = false;
    for(const funcItem of funcItems) {
      if(mrks.hasMark(funcItem)) haveMark = true;
      if(funcItem.stayVisible) {
        filesChanged.add(funcItem.parent);
        funcItem.clrStayVisible();
      }
    }
    if(!haveMark && item.filtered) {
      filesChanged.add(item);
      item.filtered = false;
    }
    for(const fileItem of filesChanged)
         sbar.updateItemInTree(fileItem);
  }
  else {
    if(settings.openFileWhenExpanded)
      await utils.revealEditorByFspath(item.document.uri.fsPath);    
  }
  item.expanded = expanded;
}

////////////////////// Gutter //////////////////////

let gutDecLgtUri: vscode.Uri;
let gutDecDrkUri: vscode.Uri;
let gutterDec:    vscode.TextEditorDecorationType;
let decRanges:    vscode.DecorationOptions[] = [];

function initGutter() {
  gutDecLgtUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-lgt.svg'));
  gutDecDrkUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-drk.svg'));
  gutterDec    = getGutterDec();
}

function getGutterDec() {
  return vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    light: { gutterIconPath: gutDecLgtUri},
    dark:  { gutterIconPath: gutDecDrkUri}
  });
};

vscode.window.onDidChangeActiveColorTheme(() => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
  const editor = vscode.window.activeTextEditor;
  if(!decRanges || !editor) return;
  editor.setDecorations(gutterDec, decRanges);
});

export async function updateGutter(editor:   vscode.TextEditor, 
                             fileItem: FileItem) {
  const children = await fileItem.getChildren();
  decRanges = [];
  for(const funcItem of [...children]) {
    if(!mrks.hasMark(funcItem)) continue;
    const lineNumber = funcItem.getStartLine();
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  }
  editor.setDecorations(gutterDec, decRanges);
}

export async function setMark(funcItem: FuncItem, 
          toggle = false, mark:boolean = false): Promise<boolean | undefined> {
  // log('setMark', funcItem.name, toggle, mark);
  const fsPath = funcItem.getFsPath();
  if(!fsPath) return;
  const funcId  = funcItem.funcId;
  const markSet = mrks.getMarkSet(fsPath);
  let marked    = markSet.has(funcId);
  let wasMarked = marked;
  if (toggle) marked = !marked;
  else        marked = mark;
  if(marked === wasMarked)  return;
  if(marked) mrks.addMark(fsPath, funcId);
  else       mrks.delMark(funcItem);
  sbar.updateItemInTree(funcItem.parent);
  if(marked) await sbar.revealItemByFunc(funcItem);
  const activeEditor = vscode.window.activeTextEditor;
  if(!activeEditor || activeEditor.document.uri.fsPath !== fsPath) return;
  await updateGutter(activeEditor, funcItem.parent);
  return marked;
}

let pointerItems = new Set<FuncItem>();

export async function updatePointers() {
  // if(!treeView) debugger;
  // if(!treeView.visible) return;
  const oldPointerItems = new Set(pointerItems);
  pointerItems.clear();
  const newPointerItems = await getFuncsOverlappingSelections();
  for(const funcItem of newPointerItems) pointerItems.add(funcItem);
  for(const funcItem of oldPointerItems)sbar.updateItemInTree(funcItem);
  for(const funcItem of newPointerItems)sbar.updateItemInTree(funcItem);
}


///////////////////// editor text //////////////////////

export async function getFuncInAroundSelection() : Promise<FuncItem | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return null;
  const fileItem = await itmc.getOrMakeFileItemByFsPath(fsPath);
  if(!fileItem) return null;
  const children = await fileItem.getChildren(true);
  if (!children || children.length === 0) return null;
  const funcsInSelection:     FuncItem[] = [];
  const funcsAroundSelection: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    for(const func of children) {
      const funcStartLine = func.getStartLine();
      const funcEndLine   = func.getEndLine();
      const selRange  = new vscode.Range(selStartLine,  0, selEndLine,  0);
      const funcRange = new vscode.Range(funcStartLine, 0, funcEndLine, 0);
      if (selRange.contains(funcRange)) funcsInSelection.push(func);
      if (funcsInSelection.length == 0 && funcRange.contains(selRange))
         funcsAroundSelection.push(func);
    }
  }
  if(funcsInSelection.length > 0) {
    let maxFuncLenIn = -1;
    let biggestFuncInSelection = null;
    for(const func of funcsInSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen > maxFuncLenIn) {
        maxFuncLenIn = funcLen;
        biggestFuncInSelection = func;
      }
    }
    return biggestFuncInSelection;
  }
  if(funcsAroundSelection.length > 0) {
    let minFuncLenAround = 1e9;
    let smallestFuncAroundSelection = null;
    for(const func of funcsAroundSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen < minFuncLenAround) {
        minFuncLenAround = funcLen;
        smallestFuncAroundSelection = func;
      }
    }
    return smallestFuncAroundSelection;
  }
  return null;
}

export async function getFuncsOverlappingSelections(): Promise<FuncItem[]> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  const fileItem = await itmc.getOrMakeFileItemByFsPath(fsPath);
  if(!fileItem) return [];
  const children = await fileItem.getChildren();
  if (!children || children.length === 0) return [];
  const overlapping: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStart = selection.start.line;
    const selEnd   = selection.end.line;
    for (const func of children) {
      const funcStart = func.getStartLine();
      if(funcStart > selEnd) break;
      const funcEnd = func.getEndLine();
      if (selStart <= funcEnd && funcStart <= selEnd) {
        overlapping.push(func);
      }
    }
  }
  return overlapping;
}

export async function scrollAndFlash(editor: vscode.TextEditor, 
          startPos: vscode.Position, endPos: vscode.Position, red = false) {
  await sett.setScroll(  editor, startPos.line, endPos.line);
  utils.flashRange(editor, startPos.line, endPos.line, red);
}

export async function revealFuncInEditor(
               itemDoc: vscode.TextDocument | FuncItem | null, red = false) {
  if(itemDoc instanceof FuncItem) {
    const document = itemDoc.parent.document;
    const editor = await vscode.window.showTextDocument(
                          document, { preview: true });
    const startPos = document.positionAt(itemDoc.start);
    const endPos   = document.positionAt(itemDoc.end);
    await scrollAndFlash(editor, startPos, endPos, red);
    editor.selection = new vscode.Selection(startPos, startPos);
  }
  else if(itemDoc) await vscode.window.showTextDocument(
      itemDoc.uri, {preview: true, preserveFocus: true });
}

