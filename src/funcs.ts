// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/
// https://github.com/estree/estree/blob/master/es5.md
// https://hexdocs.pm/estree/api-reference.html
/*
ClassExpression
YieldExpression
*/
import vscode     from 'vscode';
import * as path  from 'path';
import * as acorn from "acorn-loose";
import * as walk  from 'acorn-walk';
import {settings} from './settings';
import * as sett  from './settings';
import * as utils from './utils.js';
const {log, start, end} = utils.getLog('func');

const LOAD_FUNCS_ON_START = true;
// const LOAD_FUNCS_ON_START = false;

let context:    vscode.ExtensionContext;
let funcsByKey: Map<string, Func> = new Map();

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate funcs');
  context = contextIn;
  await loadFuncStorage();
  await updateFuncsInFile();
  end('activate funcs', false);
}

export class Func {
  document:   vscode.TextDocument;
  name:       string;
  type:       string;
  start:      number;
  endName:    number;
  end:        number;
  marked:     boolean;
  parents:    Func[] = [];
  key:        string = '';
  startLine?: number;
  endLine?:   number;
  startKey?:  string;
  endKey?:    string;
  fsPath?:    string;
  constructor(p:any) {
    const {document, name, type, start, endName, end} = p;
    this.document = document;
    this.name     = name;
    this.type     = type;
    this.start    = start;
    this.endName  = endName;
    this.end      = end;
    this.marked   = false;
  }
  getFsPath()      { return this.fsPath    ??= 
                            this.document.uri.fsPath;}
  getStartLine()   { return this.startLine ??= 
                            this.document.positionAt(this.start).line;}
  getEndLine()     { return this.endLine   ??= 
                            this.document.positionAt(this.end).line;}
  getStartKey()    { return this.startKey  ??= utils.createSortKey( 
                            this.getFsPath(), this.getStartLine());      }
  getEndKey()      { return this.endKey    ??= utils.createSortKey(
                            this.getFsPath(), this.getEndLine());        }
}

export async function updateFuncsInFile(
                         document: vscode.TextDocument | null = null) {
  start('updateFuncsInFile', true);
  if(!document) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) document = activeEditor.document;
  }
  if(!document) return;

  const uri = document.uri;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return;

  const docText = document.getText();
  if (!docText || docText.length === 0) return;

  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return;
  }
  let funcs: Func[] = [];
  function addFunc(name: string, type: string, 
                   start: number, endName: number, end: number) {
    funcs.push(new Func({document, name, type, start, endName, end}));
  }
  walk.ancestor(ast, {
    Property(node){
      const {start, end, key} = node;
      const endName = key.end;
      const name = docText.slice(start, endName);
      const type = 'Property';
      addFunc(name, type, start, endName, end);
    },
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init) {
        const endName = id.end!;
        const name = docText.slice(start, endName);
        const type  = 'VariableDeclarator';
        addFunc(name, type, start, endName, end);
      }
      return;
    },
    FunctionDeclaration(node) {
      const start   = node.id!.start;
      const endName = node.id!.end;
      const end     = node.end;
      const name    = docText.slice(start, endName);
      const type    = 'FunctionDeclaration';
      addFunc(name, type, start, endName, end);
      return;
    },
    Class(node) {
      if(!node.id) return;
      const {id, start, end, type} = node;
      const endName = id.end;
      const name    = id.name;
      addFunc(name, type, start, endName, end);
      return;
    },
    MethodDefinition(node) {
      const {start, end, key, kind} = node;
      const endName = key.end;
      if(kind      == 'constructor') {
        const name  = 'constructor';
        const type  = 'Constructor';
        addFunc(name, type, start, endName, end);
        return;
      }
      else {
        const name = docText.slice(start, endName);
        const type = 'Method';
        addFunc(name, type, start, endName, end);
        return;
      }
    }
  });
  const newFuncs = funcs.sort((a, b) => a.start - b.start);
  for(const newFunc of newFuncs) {
    const parents: Func[] = [];
    for(const innerFunc of newFuncs) {
      if(innerFunc === newFunc) continue;
      if(innerFunc.start > newFunc.start) break;
      if(innerFunc.end  >= newFunc.end) parents.unshift(innerFunc);
    }
    newFunc.parents = parents;
    let key = newFunc.name  + "\x00" + newFunc.type   + "\x00";
    for(let parent of parents) 
      key += parent.name + "\x00" + parent.type + "\x00";
    key += newFunc.getFsPath();
    newFunc.key = key;
  }
  const oldFuncs = getFuncs({fsPath: uri.fsPath, deleteFuncsBykey: true});
  let matchCount = 0;
  for(const newFunc of newFuncs) {
    funcsByKey.set(newFunc.key, newFunc);
    for(const oldFunc of oldFuncs) {
      if(newFunc.key === oldFunc.key) {
        newFunc.marked = oldFunc.marked;
        matchCount++;
        break;
      }
    }
  }
  await saveFuncStorage();
  console.log(`updated funcs in ${path.basename(uri.fsPath)}, `+
                      `marks copied: ${matchCount} of ${funcs.length}`);
  end('updateFuncsInFile');
  return;
}

export function getFuncs(p: any | {} = {}) : Func[] {
  const {fsPath, filtered = false, deleteFuncsBykey = false} = p;
  let funcs;
  if(fsPath) funcs = Array.from(funcsByKey.values())
                          .filter(func => func.getFsPath() === fsPath);
  else funcs = [...funcsByKey.values()];
  if(filtered && !deleteFuncsBykey) 
        funcs = funcs.filter(func => func.marked);
  if(deleteFuncsBykey) 
    for(const func of funcs) funcsByKey.delete(func.key); 
  return funcs;
}

export function getFuncBykey(key: string) : Func | undefined {
  return funcsByKey.get(key);
}

function sortFuncsByAlpha(funcs: Func[]) : Func[]{
  function sortKeyAlpha(a: Func) {
    return a.getFsPath() + "\x00" + a.name;
  }
  return funcs.sort((a, b) => {
    if (sortKeyAlpha(a) > sortKeyAlpha(b)) return +1;
    if (sortKeyAlpha(a) < sortKeyAlpha(b)) return -1;
    return 0;
  });
}

export function getSortedFuncs(p: any = {}) : Func[] {
  const {fsPath, alpha = false} = p;
  const funcs = getFuncs(p);
  if(funcs.length === 0) return [];
  if (!fsPath) {
    if (alpha) return sortFuncsByAlpha(funcs);
    return funcs.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return +1;
      if (a.getStartKey() < b.getStartKey()) return -1;
      return 0;
    });
  } 
  if (alpha) return funcs.sort((a, b) => a.name.localeCompare(b.name));
  return funcs.sort((a, b) => a.start - b.start);
}

export function getFuncAtLine( fsPath: string, 
                               lineNumber: number) : Func | null {
  const funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return null;
  let minFunc: Func | null = null;
  let minFuncLen = 1e9;
  for(const func of funcs) {
    if(lineNumber >= func.getStartLine() && lineNumber < (func.getEndLine() + 1)) {
      if((func.getEndLine() - func.getStartLine()) < minFuncLen) {
        minFuncLen = func.getEndLine() - func.getStartLine();
        minFunc = func;
      }
    }
  }
  return minFunc;
}

export function getFuncInAroundSelection() : Func | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return null;
  let funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return null;
  const funcsInSelection:     Func[] = [];
  const funcsAroundSelection: Func[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    for(const func of funcs) {
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

export function getFuncsOverlappingSelections(): Func[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  let funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return [];
  const overlapping: Func[] = [];
  for (const selection of editor.selections) {
    const selStart = selection.start.line;
    const selEnd   = selection.end.line;
    for (const func of funcs) {
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

export async function revealFunc(document: vscode.TextDocument | null, 
                       func: Func | null, red = false) {
  if(func) {
    document = func.document;
    const editor = await vscode.window.showTextDocument(
                          document, { preview: true });
    const startPos = document.positionAt(func.start);
    const endPos   = document.positionAt(func.end);
    utils.scrollToTopMarginAndFlash(editor, startPos, endPos, 
                                     settings.topMargin, red);
    editor.selection = new vscode.Selection(startPos, startPos);
  }
  else if(document) {
    await vscode.window.showTextDocument(document.uri, 
                   {preview: true, preserveFocus: true });
  }
}

async function loadFuncStorage() {
  if(LOAD_FUNCS_ON_START) {
    const funcs = context.workspaceState.get('funcs', []);
    for (const funcObj of funcs) {
      const func = Object.create(Func.prototype);
      Object.assign(func, funcObj);
      try {
        func.document = await vscode.workspace.openTextDocument(
                              vscode.Uri.file(func.getFsPath()));
        funcsByKey.set(func.key, func);
      } catch(err) {
        log('loadFuncStorage', func, err);
      }
    }
  }
  else await saveFuncStorage();
}

export async function saveFuncStorage() {
  await context.workspaceState.update('funcs', getFuncs());
}
