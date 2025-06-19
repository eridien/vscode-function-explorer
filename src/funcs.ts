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

let context:       vscode.ExtensionContext;
let funcsById:     Map<string, Func> = new Map();

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
  parents:   Func[] = [];
  id=         '';
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
      if(kind == 'constructor') {
        const name = 'constructor';
        const type = 'Constructor';
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
    let id = newFunc.name  + "\x00" + newFunc.type   + "\x00";
    for(let parent of parents) 
      id += parent.name + "\x00" + parent.type + "\x00";
    id += newFunc.getFsPath();
    newFunc.id = id;
  }
  const oldFuncs = getFuncs({fsPath: uri.fsPath});
  let matchCount = 0;
  for(const newFunc of newFuncs) {
    funcsById.set(newFunc.id, newFunc);
    for(const oldFunc of oldFuncs) {
      if(newFunc.id === oldFunc.id) {
        newFunc.marked = oldFunc.marked;
        matchCount++;
        break;
      }
    }
  }
  funcs = newFuncs;
  await saveFuncStorage();
  console.log(`updated funcs in ${path.basename(uri.fsPath)}, `+
                      `marks copied: ${matchCount} of ${funcs.length}`);
  end('updateFuncsInFile');
  return;
}

export function getFuncs(p: any | {} = {}) : Func[] {
  const {fsPath, filtered = false} = p;
  let funcs;
  if(fsPath) {
    funcs = Array.from(funcsById.values())
                 .filter(func => func.getFsPath() === fsPath);
  }
  else funcs = [...funcsById.values()];
  if(filtered) funcs = funcs.filter(func => func.marked);
  return funcs;
}

export function getFuncById(id: string) : Func | undefined {
  return funcsById.get(id);
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
export function getbiggestFuncsContainingSelections() : Func[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  let funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return [];
  let biggestFuncsContainingSelections: Func[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    const funcsContainingSelection: Func[] = [];
    for(const func of funcs) {
      const funcStartLine = func.getStartLine();
      const funcEndLine   = func.getEndLine();
      log('gbfcs', {selStartLine, selEndLine,   
                    funcStartLine,funcEndLine});
      const selRange  = new vscode.Range(selStartLine, 0,  selEndLine, 0);
      const funcRange = new vscode.Range(funcStartLine, 0, funcEndLine, 0);
      if (selRange.contains(funcRange)) 
        funcsContainingSelection.push(func);
    }
    let maxFuncLen = -1;
    let biggestFuncContainingSelection: Func | null = null;
    for(const func of funcsContainingSelection) {
      const funcLen = func.getEndLine() - func.getStartLine();
      if(funcLen > maxFuncLen) {
        maxFuncLen = funcLen;
        biggestFuncContainingSelection = func;
      }
    }
    if(biggestFuncContainingSelection) biggestFuncsContainingSelections
                                 .push(biggestFuncContainingSelection);
  }
  return biggestFuncsContainingSelections;
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
        funcsById.set(func.id!, func);
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
