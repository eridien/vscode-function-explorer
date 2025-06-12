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
const {log, start, end} = utils.getLog('func');

const LOAD_FUNCS_ON_START = true;
// const LOAD_FUNCS_ON_START = false;

const VERIFY_FUNCS_IN_DUMP = true;
// const VERIFY_FUNCS_IN_DUMP = false;

let context:   vscode.ExtensionContext;
let funcsById: Map<string, Func> = new Map();

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate funcs');
  context = contextIn;
  await loadFuncStorage();
  end('activate funcs');
}

export class Func {
  document:   vscode.TextDocument;
  name:       string;
  type:       string;
  start:      number;
  end:        number;
  marked:     boolean;
  pointer:    boolean;
  parents?:   Func[];
  id?:        string;
  startLine?: number;
  endLine?:   number;
  startKey?:  string;
  endKey?:    string;
  fsPath?:    string;
  constructor(p:any) {
    const {document, name, type, start, end} = p;
    this.document = document;
    this.name     = name;
    this.type     = type;
    this.start    = start;
    this.end      = end;
    this.marked   = false;
    this.pointer  = false;
  }
  getFsPath()    { return this.fsPath    ??= 
                          this.document.uri.fsPath;                    }
  getStartLine() { return this.startLine ??= 
                          this.document.positionAt(this.start).line;   }
  getEndLine()   { return this.endLine   ??= 
                          this.document.positionAt(this.end).line;     }
  getStartKey()  { return this.startKey  ??= utils.createSortKey( 
                          this.getFsPath(), this.getStartLine());      }
  getEndKey()    { return this.endKey    ??= utils.createSortKey(
                          this.getFsPath(), this.getEndLine());        }
  equalsPos(func:Func) { 
    return (this.start === func.start && this.end === func.end);
  }
}

export async function updateFuncsInFile(
               document: vscode.TextDocument|null = null): 
                  Promise<{updatedFuncs: Func[], structureChanged: boolean}> {
  start('updateFuncsInFile', true);
  const updatedFuncs: Func[] = [];
  let   structureChanged = false;
  let addCount    = 0;
  let removeCount = 0;
  let chgCount    = 0;
  const nullReturn = {updatedFuncs: [], structureChanged: false};
  if(!document) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) document = activeEditor.document;
  }
  if(!document) return nullReturn;

  const uri = document.uri;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return nullReturn;

  const docText = document.getText();
  if (!docText || docText.length === 0) return nullReturn;

  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return nullReturn;
  }
  let funcs: Func[] = [];
  function addFunc(name: string, type: string, start: number, end: number) {
    if(type != 'FunctionDeclaration'     && 
       type != 'FunctionExpression'      &&
       type != 'ArrowFunctionExpression' &&
       type != 'Constructor'             &&
       type != 'Method') {
      return;
    }
    funcs.push(new Func({document, name, type, start, end}));
  }
  walk.ancestor(ast, {
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init &&
         (init.type === 'ArrowFunctionExpression' ||
          init.type === 'FunctionExpression')) {
        const name = docText.slice(start, id.end!);
        const type  = init.type;
        addFunc(name, type, start, end);
      }
      return;
    },
    FunctionDeclaration(node) {
      const start = node.id!.start;
      const end   = node.end;
      const name  = docText.slice(start, node.id!.end!);
      const type  = 'FunctionDeclaration';
      addFunc(name, type, start, end);
      return;
    },
    AssignmentExpression(node) {
      const {start, end, left, right} = node;
      const name = docText.slice(left.start!, left.end!);
      const type = right.type;
      addFunc(name, type, start, end);
      return;
    },
    MethodDefinition(node, _state, ancestors) {
      let type:string;
      const classDecNode = ancestors.find(
                    cn => cn.type === 'ClassDeclaration');
      if (!classDecNode) {
        log('err', 'Method without Class');
        return;
      }
      let className = (classDecNode as any).id.name ;
      let name: string;
      if(node.kind == 'constructor') {
        name = className + '.constructor';
        type = 'Constructor';
      }
      else {
        name = (node.key as any).name + ' @ ' + className;
        type = 'Method';
      }
      const start = node.start;
      const end   = node.end;
      addFunc(name, type, start, end);
      return;
    }
  });
  for(const func of funcs) {
    const parents: Func[] = [];
    for(const parentFunc of funcs) {
      if(parentFunc === func) continue;
      if(parentFunc.start > func.start) break;
      if(parentFunc.end  >= func.end) parents.unshift(parentFunc);
    }
    func.parents = parents;
    let id = func.name  + "\x00" + func.type   + "\x00";
    for(let parent of parents) 
      id += parent.name + "\x00" + parent.type + "\x00";
    id += func.getFsPath();
    func.id = id;
  }
  funcs.sort((a, b) => a.start - b.start);
  const oldFuncs = getSortedFuncs({fsPath: uri.fsPath, alpha:false});
  let oldIdx = 0;
  let newIdx = 0;
  while(true) {
    if(newIdx >= funcs.length) {
      while(oldIdx < oldFuncs.length) {
        funcsById.delete(oldFuncs[oldIdx].id!);
        structureChanged = true;
        oldIdx++;
        removeCount++;
      }
      break;
    }
    if(oldIdx >= oldFuncs.length) {
      while(newIdx < funcs.length) {
        funcsById.set(funcs[newIdx].id!, funcs[newIdx]);
        structureChanged = true;
        newIdx++;
        addCount++;
      }
      break;
    }
    const oldFunc = oldFuncs[oldIdx];
    const newFunc = funcs[newIdx];
    if(oldFunc.equalsPos(newFunc)) {
      if(oldFunc.id !== newFunc.id) {
        structureChanged = true;
        newFunc.marked = oldFunc.marked;
        funcsById.delete(oldFunc.id!);
        funcsById.set(newFunc.id!, newFunc);
        oldIdx++; newIdx++;
        chgCount++;
        continue;
      }
      oldIdx++; newIdx++;
    } else if(oldFunc.start < newFunc.start) {
      structureChanged = true;
      funcsById.delete(oldFunc.id!);
      oldIdx++;
      removeCount++;
    } else {
      structureChanged = true;
      funcsById.set(newFunc.id!, newFunc);
      newIdx++;
      addCount++;
    }
  } 

  await saveFuncStorage();
  const msg = `${path.basename(uri.fsPath)}, `+
      (structureChanged ? 'structureChanged, ' : '') +
    `+${addCount} -${removeCount} m${chgCount}`;
  end('updateFuncsInFile', false, msg);
  return {updatedFuncs, structureChanged};
}

export function getFuncs(p: any | {} = {}) : Func[] {
  const {fsPath, markedOnly = false} = p;
  let funcs;
  if(fsPath) {
    funcs = Array.from(funcsById.values())
                 .filter(func => func.getFsPath() === fsPath);
  }
  else funcs = [...funcsById.values()];
  if(markedOnly) funcs = funcs.filter(func => func.marked);
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
  let match: Func | null = null;
  for(const func of funcs) {
    if(func.getStartLine() >  lineNumber) return match;
    if(func.getEndLine()   >= lineNumber) match = func;
  }
  return match;
}

export function getFuncsBetweenLines(fsPath: string, 
                                  startLine: number, endLine: number, 
                                  overRideSubChk: boolean = false) : Func[] {
  let funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return [];
  let matches: Func[] = [];
  for(const func of funcs) {
    const funcStartLine = func.getStartLine();
    if(funcStartLine >  endLine) break;
    if(funcStartLine >= startLine) matches.push(func);
  }
  if(!settings.includeSubFunctions) {
    let minDepth = 1e9;
    for(const func of matches) {
      const depth = func.parents!.length;
      if(depth < minDepth) minDepth = depth;
    }
    const subFuncs = [];
    for(const func of matches) {
      const depth = func.parents!.length;
      if(depth == minDepth || overRideSubChk) 
        subFuncs.push(func);
    }
    return subFuncs;
  }
  return matches;
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
    const position = document.positionAt(start);
    const range    = new vscode.Range(position.line, 0, position.line, 0);
    editor.revealRange(range, settings.scrollPosition);
    if(selection) 
      editor.selection = new vscode.Selection(range.start, range.end);
  }
  else if(document) {
    await vscode.window.showTextDocument(document.uri, 
                   {preview: true, preserveFocus: true });
  }
}

export function removeAllPointers() {
  log('removeAllPointers');
  funcsById.forEach(func => func.pointer = false);
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
  removeAllPointers();
  await saveFuncStorage();
}

export async function saveFuncStorage() {
  await context.workspaceState.update('funcs', getFuncs());
}
