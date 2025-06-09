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

let context: vscode.ExtensionContext;

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate funcs');
  context = contextIn;
  await loadFuncStorage();
  end('activate funcs');
}

export class Func {
  wsFolder?:      vscode.WorkspaceFolder;
  document:       vscode.TextDocument;
  name:           string;
  type:           string;
  start:          number;
  end:            number;
  parents?:       Func[];
  id?:            string;
  startLine?:     number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  fsPath?:        string;
  marked:        boolean;
  missing:        boolean;
  constructor(p:any) {
    const {document, name, type, start, end} = p;
    this.document  = document;
    this.name      = name;
    this.type      = type;
    this.start     = start;
    this.end       = end;
    this.marked   = false;
    this.missing   = false;
  }
  getWsFolder()  { 
    this.wsFolder ??= vscode.workspace
                            .getWorkspaceFolder(this.document.uri);
    if(!this.wsFolder) {
      log('err', 'getWsFolder, func has no workspace folder', 
                    this.name, this.getFsPath());
      throw new Error('Func has no workspace folder');
    }
    return this.wsFolder;
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
    return (this.start === func.start &&
            this.end   === func.end);
  }
}

let funcsById:     Map<string, Func> = new Map();
let funcsByFsPath: Map<string, Map<string, Func>> = new Map();

export function setFuncInMaps(func: Func): boolean {
  func.missing  = false; 
  const fsPath  = func.getFsPath();
  const oldFunc = funcsById.get(func.id!);
  if(oldFunc) func.marked = oldFunc.marked; 
  funcsById.set(func.id!, func);
  let funcMap = funcsByFsPath.get(fsPath);
  if (!funcMap) {
    funcMap = new Map<string, Func>();
    funcsByFsPath.set(fsPath, funcMap);
  }
  funcMap.set(func.id!, func);
  return !oldFunc || !func.equalsPos(oldFunc);
}

export async function updateFuncsInFile(
               document: vscode.TextDocument|null = null): Promise<Func[]> {
  start('updateFuncsInFile', true);
  const updatedFuncs: Func[] = [];
  if(!document) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) document = activeEditor.document;
  }
  if(!document) return [];
  const uri = document.uri;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return [];
  const docText = document.getText();
  if (!docText || docText.length === 0) return [];
  const docFuncs = funcsByFsPath.get(uri.fsPath);
  for (const func of (docFuncs ? docFuncs.values() : [])) 
    func.missing = true;
  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return [];
  }
  const funcs: Func[] = [];
  function addFunc(name: string, type: string, start: number, end: number) {
    if(type != 'FunctionDeclaration'     && 
       type != 'FunctionExpression'      &&
       type != 'ArrowFunctionExpression' &&
       type != 'Constructor'             &&
       type != 'Method') {
      // log('err', 'addFunc, non-function type', type, ', with name', name);
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
      const type  = right.type;
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
  funcs.sort((a, b) => a.start - b.start);
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
    if(setFuncInMaps(func)) updatedFuncs.push(func);
  }
  await saveFuncStorage();
  const msg = `updated ${path.basename(uri.fsPath)}, `+
    `${updatedFuncs.length}:${funcs.length}` + 
      (updatedFuncs.length > 0 ? '  <<<<<<<<<<' : '');
  end('updateFuncsInFile', false, msg);
  return updatedFuncs;
}

export function getFuncs(p: any | {} = {}) : Func[] {
  const {markedOnly = false, includeMissing = false, fsPath} = p;
  let funcs;
  if(fsPath) {
    const fileFuncMap = funcsByFsPath.get(fsPath);
    if (!fileFuncMap) return [];
    funcs = Array.from(fileFuncMap.values());
  }
  else funcs = [...funcsById.values()];
  if(markedOnly)     funcs = funcs.filter(func =>  func.marked);
  if(!includeMissing) funcs = funcs.filter(func => !func.missing);
  return funcs;
}

function sortKeyAlpha(a: Func) {
  return a.getFsPath() + "\x00" + a.name;
}

export function getSortedFuncs(p: any = {}) : Func[] {
  const {fsPath, reverse = false, alpha = false} = p;
  const funcs = getFuncs(p);
  if(funcs.length === 0) return [];
  if (!fsPath) {
    if (alpha) {
      return funcs.sort((a, b) => {
        if (sortKeyAlpha(a) > sortKeyAlpha(b)) return reverse? -1 : +1;
        if (sortKeyAlpha(a) < sortKeyAlpha(b)) return reverse? +1 : -1;
        return 0;
      });
    }
    return funcs.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return reverse? -1 : +1;
      if (a.getStartKey() < b.getStartKey()) return reverse? +1 : -1;
      return 0;
    });
  } 
  if (alpha) {
    if(reverse) return funcs.sort((a, b) => b.name.localeCompare(a.name));
    else        return funcs.sort((a, b) => a.name.localeCompare(b.name));
  }
  return funcs.sort((a, b) =>
    reverse? b.start - a.start : a.start - b.start
  );
}

export function getFuncAtLine( fsPath: string, 
                               lineNumber: number) : Func | null {
  const funcs = getSortedFuncs({fsPath});
  if (funcs.length === 0) return null;
  let match: Func | null = null;
  for(const func of funcs) {
    if(func.getStartLine() > lineNumber) return match;
    if(func.getEndLine()   > lineNumber) match = func;
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
      if(!func.missing && depth < minDepth) minDepth = depth;
    }
    const subFuncs = [];
    for(const func of matches) {
      const depth = func.parents!.length;
      if(!func.missing && func.marked &&
            (depth == minDepth || overRideSubChk)) 
        subFuncs.push(func);
    }
    return subFuncs;
  }
  return matches;
}

async function loadFuncStorage() {
  if(LOAD_FUNCS_ON_START) {
    const funcs = context.workspaceState.get('funcs', []);
    for (const funcObj of funcs) {
      const func = Object.create(Func.prototype);
      Object.assign(func, funcObj);
      func.document =
        await vscode.workspace.openTextDocument(func.getFsPath());
      setFuncInMaps(func);
    }
  }
  await saveFuncStorage();
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

export async function saveFuncStorage() {
  await context.workspaceState.update('funcs', getFuncs());
}

function deleteFuncFromFileSet(func: Func) {
  let funcMap = funcsByFsPath.get(func.getFsPath());
  if (funcMap) {
    funcMap.delete(func.id!);
    if(funcMap.size === 0) funcsByFsPath.delete(func.getFsPath());
  }
}

function verifyFunc(func: Func): boolean {
  const document  = func.document;
  const startLine = func.getStartLine();
  const numLines  = document.lineCount;
  if(startLine < 0 || startLine >= numLines) {
    log('err', 'verifyFunc, line number out of range',
                func.getFsPath(), startLine);
    return false;
  }
  const lineText = document.lineAt(startLine).text;
  if(!lineText) {
    log('err', 'verifyFunc, line text is empty',
                func.getFsPath(), startLine);
    return false;
  }
  if(!lineText.includes(func.name)) {
    log('err', 'verifyFunc, line text does not include func name',
                func.getFsPath(), startLine, func.name);
    return false;
  }
  return true;
}

function dumpFuncs(caller: string, list: boolean, dump: boolean) {
  caller = caller + ' funcs: ';
  let funcs = Array.from(funcsById.values());
  if(funcs.length === 0) {
    log(caller, '<no funcs>');
    return;
  }
  if(dump) log(caller, 'all funcs', funcs);
  else if(list) {
    funcs.sort((a, b) => a.start - b.start);
    let str = "\n";
    for(const func of funcs) {
      if(VERIFY_FUNCS_IN_DUMP) verifyFunc(func);
      str += `${func.name}, ${func.getFsPath()}, ${func.start}\n`;
    }
    log(caller, str.slice(0,-1));
  }
  else {
    let str = "";
    for(const func of funcs) {
      if(VERIFY_FUNCS_IN_DUMP) verifyFunc(func);
      str += func.name;
    }
    log(caller, str);
  }
}

export function markItemClick(item:any) {
  log('funcItemClick', item);
}
