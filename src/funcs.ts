// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/

import vscode     from 'vscode';
import * as path  from 'path';
import * as acorn from "acorn-loose";
import * as walk  from 'acorn-walk';
import {settings} from './settings';
import * as sett  from './settings';
import * as utils from './utils.js';
import { updateSide } from './commands';
const {log, start, end} = utils.getLog('func');

// const LOAD_FUNCS_ON_START = true;
const LOAD_FUNCS_ON_START = false;

let context:       vscode.ExtensionContext;
let funcsById:     Map<string, Func> = new Map();

export async function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  await loadFuncStorage();
  await updateFuncsInFile();
  end('activate funcs');
}

export class Func {
  document:   vscode.TextDocument;
  name:       string;
  type:       string;
  start:      number;
  endName:    number;
  end:        number;
  marked:     boolean;
  parents?:   Func[];
  id?:        string;
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
                          this.document.uri.fsPath;                    }
  getStartLine()   { return this.startLine ??= 
                          this.document.positionAt(this.start).line;   }
  getEndLine()     { return this.endLine   ??= 
                          this.document.positionAt(this.end).line;     }
  getStartKey()    { return this.startKey  ??= utils.createSortKey( 
                          this.getFsPath(), this.getStartLine());      }
  getEndKey()      { return this.endKey    ??= utils.createSortKey(
                          this.getFsPath(), this.getEndLine());        }
  equalsPos(func:Func) { 
    return (this.start === func.start && this.end === func.end);
  }
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
    if(type != 'FunctionDeclaration'     && 
       type != 'FunctionExpression'      &&
       type != 'ArrowFunctionExpression' &&
       type != 'ClassDeclaration'        &&
       type != 'Constructor'             &&
       type != 'Method') {
      return;
    }
    funcs.push(new Func({document, name, type, start, endName, end}));
  }
  walk.ancestor(ast, {
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init &&
         (init.type === 'ArrowFunctionExpression' ||
          init.type === 'FunctionExpression')) {
        const endName = id.end!;
        const name = docText.slice(start, endName);
        const type  = init.type;
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
    AssignmentExpression(node) {
      const {start, end, left, right} = node;
      const endName = left.end!;
      const name = docText.slice(left.start!, endName);
      const type = right.type;
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
    funcsById.set(newFunc.id!, newFunc);
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
  const msg = `updated funcs in ${path.basename(uri.fsPath)}, `+
                      `matched: ${matchCount} of ${funcs.length}`;
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
  const funcs = getFuncs({fsPath});
  if (funcs.length === 0) return null;
  let match: Func | null = null;
  for(const func of funcs) {
    if(func.getStartLine() >  lineNumber) return match;
    if(func.getEndLine()   >= lineNumber) match = func;
  }
  return match;
}

export function getFuncsOverlappingSelections(lineOnly = false) : Func[]{
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  let funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return [];
  let touching: Func[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    const overlaps: Func[] = [];
    for(const func of funcs) {
      const funcStartLine = func.getStartLine();
      const funcEndLine   = func.getEndLine();
      if (utils.rangesOverlap(selStartLine,  selEndLine, 
                              funcStartLine, lineOnly ? funcStartLine 
                                                      : funcEndLine))
        overlaps.push(func);
    }
    if(!settings.includeSubFunctions) {
      let minDepth = 1e9;
      for(const func of overlaps) {
        const depth = func.parents!.length;
        if(depth < minDepth) minDepth = depth;
      }
      const nonSubFuncs = [];
      for(const func of overlaps) {
        const depth = func.parents!.length;
        if(depth == minDepth) nonSubFuncs.push(func);
      }
      touching.push(...nonSubFuncs);
    }
    else touching.push(...overlaps);
  }
  return touching;
}

export async function revealFunc(document: vscode.TextDocument | null, 
                                 func: Func | null, selection = false) {
  let start: number | null = null;
  if(func) {
    document = func.document;
    start    = func.start;
  }
  if(document && start !== null) {
    const editor = await vscode.window.showTextDocument(
                          document, { preview: true });
    const startPos = document.positionAt(func?.start ?? 0);
    const endPos   = document.positionAt(func?.end   ?? 0);
    utils.scrollToTopMarginAndFlash(editor, startPos!, endPos!, 
                                            settings.topMargin);
    if(selection) editor.selection = 
                   new vscode.Selection(startPos.line, 0, startPos.line, 0);
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
      func.document = await vscode.workspace.openTextDocument(
                            vscode.Uri.file(func.getFsPath()));
      funcsById.set(func.id!, func);
    }
  }
  else await saveFuncStorage();
}

export async function saveFuncStorage() {
  await context.workspaceState.update('funcs', getFuncs());
}
