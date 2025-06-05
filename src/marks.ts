// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/

import vscode      from 'vscode';
import * as acorn  from "acorn-loose";
import * as walk   from 'acorn-walk';
import {settings}  from './settings';
import * as sett   from './settings';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mrks');

const LOAD_MARKS_ON_START = true;
// const LOAD_MARKS_ON_START = false;

const VERIFY_MARKS_IN_DUMP = true;
// const VERIFY_MARKS_IN_DUMP = false;

let context: vscode.ExtensionContext;
let initFinished = false;

export async function activate(contextIn: vscode.ExtensionContext) {
  start('init marks');
  context = contextIn;
  await loadMarkStorage();
  initFinished = true;
  end('init marks');
}

export function waitForInit() {
  if (initFinished) return Promise.resolve();
  return new Promise((resolve: any) => {
    const checkInit = () => {
      if (initFinished) { resolve(); } 
      else { setTimeout(checkInit, 50); }
    };
    checkInit();
  });
}

export async function initMarks() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath))
    await updateMarksInFile(activeEditor.document);
}

export function createSortKey(fsPath: string, lineNumber: number): string {
  return fsPath + "\x00" + lineNumber.toString().padStart(6, '0');
}

export class Mark {
  document:       vscode.TextDocument;
  name:           string;
  type:           string;
  start:          number;
  end:            number;
  parents?:       Mark[];
  id?:            string;
  startLine?:     number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  fsPath?:        string;
  enabled:        boolean;
  missing:        boolean;
  constructor(p:any) {
    const {document, name, type, start, end} = p;
    this.document  = document;
    this.name      = name;
    this.type      = type;
    this.start     = start;
    this.end       = end;
    this.enabled   = false;
    this.missing   = false;
  }
  setEnabled(enabled: boolean) { 
    this.enabled = enabled; 
    setMarkInMaps(this);
  }
  getFsPath() {
    if (this.fsPath === undefined) 
        this.fsPath = this.document.uri.fsPath;
    return this.fsPath;
  }
  getStartLine() {
    if (this.startLine === undefined) 
        this.startLine = this.document.positionAt(this.start).line;
    return this.startLine;
  }
  getEndLine() {
    if (this.endLine === undefined)
      this.endLine = this.document.positionAt(this.end).line;
    return this.endLine;
  }
  getStartKey() {
    if (this.startKey === undefined) 
        this.startKey = createSortKey(
                        this.getFsPath(), this.getStartLine());
    return this.startKey;
  }
  getEndKey() {
    if (this.endKey === undefined) 
        this.endKey = createSortKey(
                        this.getFsPath(), this.getEndLine());
    return this.endKey;
  }
}

let marksById:     Map<string, Mark> = new Map();
let marksByFsPath: Map<string, Map<string, Mark>> = new Map();

// does not filter
function setMarkInMaps(mark: Mark) {
  mark.missing = false; 
  const fsPath  = mark.getFsPath();
  const oldMark = marksById.get(mark.id!);
  if(oldMark) mark.enabled = oldMark.enabled; 
  marksById.set(mark.id!, mark);
  let markMap = marksByFsPath.get(fsPath);
  if (!markMap) {
    markMap = new Map<string, Mark>();
    marksByFsPath.set(fsPath, markMap);
  }
  markMap.set(mark.id!, mark);
}

let lastMarkName: Mark | null = null;

// does not filter
export async function updateMarksInFile(document: vscode.TextDocument) {
  start('updateMarksInFile');
  const docText = document.getText();
  if (!docText || docText.length === 0) return;
  const docMarks = marksByFsPath.get(document.uri.fsPath);
  for (const mark of (docMarks ? docMarks.values() : [])) 
    mark.missing = true;
  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return;
  }
  const marks: Mark[] = [];
  function addMark(name: string, type: string, start: number, end: number) {
    if(type != 'FunctionDeclaration'     && 
       type != 'FunctionExpression'      &&
       type != 'ArrowFunctionExpression' &&
       type != 'Constructor'             &&
       type != 'Method') {
      // log('err', 'addMark, non-function type', type, ', with name', name);
      return;
    }
    marks.push(new Mark({document, name, type, start, end}));
  }
  walk.ancestor(ast, {
    VariableDeclarator(node) {
      const {id, start, end, init} = node;
      if (init &&
         (init.type === 'ArrowFunctionExpression' ||
          init.type === 'FunctionExpression')) {
        const name = docText.slice(start, id.end!);
        const type  = init.type;
        addMark(name, type, start, end);
      }
      return;
    },
    FunctionDeclaration(node) {
      const start = node.id!.start;
      const end   = node.end;
      const name  = docText.slice(start, node.id!.end!);
      const type  = 'FunctionDeclaration';
      addMark(name, type, start, end);
      return;
    },
    AssignmentExpression(node) {
      const {start, end, left, right} = node;
      const name = docText.slice(left.start!, left.end!);
      const type  = right.type;
      addMark(name, type, start, end);
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
      addMark(name, type, start, end);
      return;
    }
  });
  marks.sort((a, b) => a.start - b.start);
  for(const mark of marks) {
    const parents: Mark[] = [];
    for(const parentMark of marks) {
      if(parentMark === mark) continue;
      if(parentMark.start > mark.start) break;
      if(parentMark.end  >= mark.end) parents.unshift(parentMark);
    }
    mark.parents = parents;
    let id = mark.name  + "\x00" + mark.type   + "\x00";
    for(let parent of parents) 
      id += parent.name + "\x00" + parent.type + "\x00";
    id += mark.getFsPath();
    mark.id = id;
    setMarkInMaps(mark);
  }
  await saveMarkStorage();
  end('updateMarksInFile', false);
}

export async function updateMarksInAllFiles() {
  for (const file of await sett.getAllFiles()) {
    const document = await vscode.workspace.openTextDocument(file);
    await updateMarksInFile(document);
  }
}

// filters
export function getMarks(p: any | {} = {}) : Mark[] {
  const {enabledOnly = false, fsPath} = p;
  let marks;
  if(fsPath) {
    const fileMarkMap = marksByFsPath.get(fsPath);
    if (!fileMarkMap) return [];
    marks = Array.from(fileMarkMap.values());
  }
  else marks = [...marksById.values()];
  if(enabledOnly) marks = marks.filter(
                          mark => mark.enabled && !mark.missing);
  return marks;
}

// filters
export function getSortedMarks(p: any = {}) : Mark[] {
  const {fsPath, reverse = false} = p;
  const marks = getMarks(p);
  if(marks.length === 0) return [];
  if (!fsPath) {
    return marks.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return reverse? -1 : +1;
      if (a.getStartKey() < b.getStartKey()) return reverse? +1 : -1;
      return 0;
    });
  } 
  return marks.sort((a, b) => 
    reverse? b.start - a.start : a.start - b.start);
}

// does not filter
export function getMarkAtLine( fsPath: string, 
                               lineNumber: number) : Mark | null {
  const marks = getSortedMarks({fsPath});
  if (marks.length === 0) return null;
  let match: Mark | null = null;
  for(const mark of marks) {
    if(mark.getStartLine() > lineNumber) return match;
    if(mark.getEndLine()   > lineNumber) match = mark;
  }
  return match;
}

// filters by includeSubFunctions
export function getMarksBetweenLines(fsPath: string, 
                                  startLine: number, endLine: number, 
                                  overRideSubChk: boolean = false) : Mark[] {
  let marks = getSortedMarks({fsPath});
  if (marks.length === 0) return [];
  let matches: Mark[] = [];
  for(const mark of marks) {
    const markStartLine = mark.getStartLine();
    if(markStartLine > endLine) break;
    if(markStartLine >= startLine) matches.push(mark);
  }
  if(!settings.includeSubFunctions) {
    let minDepth = 1e9;
    for(const mark of matches) {
      const depth = mark.parents!.length;
      if(!mark.missing && depth < minDepth) minDepth = depth;
    }
    const subMarks = [];
    for(const mark of matches) {
      const depth = mark.parents!.length;
      if(!mark.missing && (depth == minDepth ||
        (overRideSubChk && mark.enabled))) subMarks.push(mark);
    }
    return subMarks;
  }
  return matches;
}

async function loadMarkStorage() {
  if(LOAD_MARKS_ON_START) {
    const marks = context.workspaceState.get('marks', []);
    for (const markObj of marks) {
      const mark = Object.create(Mark.prototype);
      Object.assign(mark, markObj);
      mark.document =
        await vscode.workspace.openTextDocument(mark.getFsPath());
      setMarkInMaps(mark);
    }
  }
  await saveMarkStorage();
}

export async function revealMark(mark: Mark, selection = false) {
  const editor = await vscode.window.showTextDocument(
                          mark.document, { preview: true });
  const position = mark.document.positionAt(mark.start);
  const range = new vscode.Range(position.line, 0, position.line, 0);
  editor.revealRange( range, settings.scrollPosition );
  if(selection) 
    editor.selection = new vscode.Selection(range.start, range.end);
}

export async function saveMarkStorage() {
  await context.workspaceState.update('marks', getMarks());
}

function deleteMarkFromFileSet(mark: Mark) {
  let markMap = marksByFsPath.get(mark.getFsPath());
  if (markMap) {
    markMap.delete(mark.id!);
    if(markMap.size === 0) marksByFsPath.delete(mark.getFsPath());
  }
}

async function deleteMark(mark: Mark, save = true, update = true) {
  marksById.delete(mark.id!);
  deleteMarkFromFileSet(mark);
  if(save) await saveMarkStorage();
  // if(update) utils.updateSide(); 
  // await dumpMarks('deleteMark');
}

async function deleteAllMarksFromFile(fsPath: string, update = true) {
  const marks = getMarks({fsPath});
  if(marks.length === 0) return;
  for (const mark of marks) await deleteMark(mark);
  await saveMarkStorage();
  // if(update) utils.updateSide();
}

function verifyMark(mark: Mark): boolean {
  const document      = mark.document;
  const startLine = mark.getStartLine();
  const numLines      = document.lineCount;
  if(startLine < 0 || startLine >= numLines) {
    log('err', 'verifyMark, line number out of range',
                mark.getFsPath(), startLine);
    return false;
  }
  const lineText = document.lineAt(startLine).text;
  if(!lineText) {
    log('err', 'verifyMark, line text is empty',
                mark.getFsPath(), startLine);
    return false;
  }
  if(!lineText.includes(mark.name)) {
    log('err', 'verifyMark, line text does not include mark name',
                mark.getFsPath(), startLine, mark.name);
    return false;
  }
  return true;
}

function dumpMarks(caller: string, list: boolean, dump: boolean) {
  caller = caller + ' marks: ';
  let marks = Array.from(marksById.values());
  if(marks.length === 0) {
    log(caller, '<no marks>');
    return;
  }
  if(dump) log(caller, 'all marks', marks);
  else if(list) {
    marks.sort((a, b) => a.start - b.start);
    let str = "\n";
    for(const mark of marks) {
      if(VERIFY_MARKS_IN_DUMP) verifyMark(mark);
      str += `${mark.name}, ${mark.getFsPath()}, ${mark.start}\n`;
    }
    log(caller, str.slice(0,-1));
  }
  else {
    let str = "";
    for(const mark of marks) {
      if(VERIFY_MARKS_IN_DUMP) verifyMark(mark);
      str += mark.name;
    }
    log(caller, str);
  }
}
