import vscode      from 'vscode';
import ts          from "typescript";
import {settings}  from './settings.js';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mrks');

// const LOAD_MARKS_ON_START = true;
const LOAD_MARKS_ON_START = false;

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

export class Mark {
  document:  vscode.TextDocument;
  name:      string;
  kind:      string;
  start:     number;
  nameStart: number;
  nameEnd:   number;
  end:       number;
  parents?:  Mark[];
  id?:       string;
  sortKey?:  string;
  enabled:   boolean;
  constructor(node: ts.Node,
              document: vscode.TextDocument, kindIn?: string) {
    this.document  = document;
    this.name      = (node as any).name.text;
    this.kind      = kindIn ?? ts.SyntaxKind[node.kind];
    this.start     = node.getStart();
    this.nameStart = (node as any).name.getStart();
    this.nameEnd   = (node as any).name.getEnd();
    this.end       = node.getEnd();
    this.parents   = [];
    this.id        = '';
    this.enabled   = false;
  }
  setParents(parents: Mark[])  { this.parents = parents; }
  setId(id: string)            { this.id = id;           }
  setKind(kind: string)        { this.kind = kind;       }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  getGlblSortKey() {
    if (this.sortKey === undefined) 
        this.sortKey = this.document.uri.fsPath + "\x00" + 
                       this.start.toString().padStart(6, '0');
    return this.sortKey;
  }
}

let marksById:       Map<string, Mark>      = new Map();
let markSetByFsPath: Map<string, Set<Mark>> = new Map();

function addMarkToStorage(mark: Mark) {
  const oldMark = marksById.get(mark.id!);
  if (oldMark) mark.setEnabled(oldMark.enabled);
  else {
    const fsPath = mark.document.uri.fsPath;
    marksById.set(mark.id!, mark);
    let markSet = markSetByFsPath.get(fsPath);
    if (!markSet) {
      markSet = new Set();
      markSetByFsPath.set(fsPath, markSet);
    }
    markSet.add(mark);
  }
}

export async function findAllMarks(document: vscode.TextDocument) {
  start('findMarks');
  const sourceFile = ts.createSourceFile(
                              document.fileName, document.getText(), 
                              ts.ScriptTarget.Latest, true);
  const marks: Mark[] = [];
  function traverse(node: ts.Node) {
    // log('traverse', node);
    if((ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)    ||
        ts.isMethodDeclaration(node)) && node.name)
      marks.push(new Mark(node, document));
    else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isFunctionExpression(node.initializer))
        marks.push(new Mark(node, document, 'FunctionExpression'));
      else if (ts.isArrowFunction(node.initializer))
        marks.push(new Mark(node, document, 'ArrowFunction'));
    }
    ts.forEachChild(node, traverse);
  }
  traverse(sourceFile);
  for(const mark of marks) {
    const parents: Mark[] = [];
    for(const parentMark of marks) {
      if(parentMark === mark) continue;
      if(parentMark.start > mark.start) break;
      if(parentMark.end  >= mark.end) parents.unshift(parentMark);
    }
    mark.setParents(parents);
    let id = mark.name  + "\x00" + mark.kind   + "\x00";
    for(let parent of parents) 
      id += parent.name + "\x00" + parent.kind + "\x00";
    id += mark.document.uri.fsPath;
    mark.setId(id);
    addMarkToStorage(mark);
  }
  await saveMarkStorage();
  end('findMarks', false);
}

export function getMarksByFsPath(fsPath: string) {
  const fileMarkSet = markSetByFsPath.get(fsPath);
  if (fileMarkSet) return Array.from(fileMarkSet);
  return [];  
}

export function getAllMarks() {
  return [...marksById.values()];
}

export function getSortedMarks(document: vscode.TextDocument | null = null, 
                               reverse = false) : Mark[] {
  if (document === null) {
    const marks = getAllMarks();
    if(marks.length === 0) return [];
    return marks.sort((a, b) => {
      if (a.getGlblSortKey() > b.getGlblSortKey()) return reverse? -1 : +1;
      if (a.getGlblSortKey() < b.getGlblSortKey()) return reverse? +1 : -1;
      return 0;
    });
  } 
  const marks = getMarksByFsPath(document.uri.fsPath);
  return marks.sort((a, b) => reverse? b.start - a.start 
                                     : a.start - b.start);
}

export function getMarkAtPos(
              document: vscode.TextDocument, 
              index: number, global = false) : Mark | null {
  const marks = getSortedMarks(global ? null : document);
  if (marks.length === 0) return null;
  let sortKey: string | null = null;
  if(global) sortKey = document.uri.fsPath + "\x00" + 
                          index.toString().padStart(6, '0');
  function cmp(mark: Mark) : number {
    if(global) {
      if (mark.getGlblSortKey() > sortKey!) return +1;
      if (mark.getGlblSortKey() < sortKey!) return -1;
      return 0;
    }
    return mark.start - index;
  }
  ///////// body /////////
  let i = 0;
  for(; i < marks.length-1; i++) {
    if (cmp(marks[i])   > 0) return null;
    if (cmp(marks[i+1]) > 0) return marks[i];
  }
  return null;
}

async function loadMarkStorage() {
  if(LOAD_MARKS_ON_START) {
    const marks = context.workspaceState.get('marks', []);
    for (const mark of marks) addMarkToStorage(mark);
  }
  await saveMarkStorage();
}

async function saveMarkStorage() {
  await context.workspaceState.update('marks', getAllMarks());
}

function deleteMarkFromFileSet(mark: Mark) {
  let markSet = markSetByFsPath.get(mark.document.uri.fsPath);
  if (markSet) {
    markSet.delete(mark);
    if(markSet.size === 0) markSetByFsPath.delete(mark.document.uri.fsPath);
  }
}

async function deleteMark(mark: Mark, save = true, update = true) {
  if(mark?.id) marksById.delete(mark.id);
  deleteMarkFromFileSet(mark);
  if(save) await saveMarkStorage();

  // delete banner  -- todo

  // if(update) utils.updateSide(); 
  //await dumpMarks('deleteMark');
}

async function deleteAllMarksFromFile(document: vscode.TextDocument,
                                      update = true) {
  const fileMarks = getMarksByFsPath(document.uri.fsPath);
  if(fileMarks.length === 0) return;
  log('deleteAllMarksFromFile', document.uri.fsPath,);
  for (const mark of fileMarks) await deleteMark(mark, false, false);
  await saveMarkStorage();
  // if(update) utils.updateSide();
}

function getMarkAtLine(document: vscode.TextDocument, lineNumber: number) {
  const fileMarks = getMarksByFsPath(document.uri.fsPath);
  if(fileMarks.length === 0) return null;
  for(const mark of fileMarks) {
    const markStartLine = document.positionAt(mark.start).line;
    if(markStartLine === lineNumber) return mark;
  }
  return null;
}

function verifyMark(mark: Mark): boolean {
  if(!mark || !mark.document) return false;
  const document      = mark.document;
  const markStartLine = document.positionAt(mark.start).line;
  const numLines      = document.lineCount;
  if(markStartLine < 0 || markStartLine >= numLines) {
    log('err', 'verifyMark, line number out of range',
                mark.document.uri.fsPath, markStartLine);
    return false;
  }
  const lineText = document.lineAt(markStartLine).text;
  if(!lineText) {
    log('err', 'verifyMark, line text is empty',
                mark.document.uri.fsPath, markStartLine);
    return false;
  }
  if(!lineText.includes(mark.name)) {
    log('err', 'verifyMark, line text does not include mark name',
                mark.document.uri.fsPath, markStartLine, mark.name);
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
      str += `${mark.name}, ${mark.document.uri.fsPath}, ${mark.start}\n`;
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

/*
kinds supported ...
  FunctionDeclaration
  ClassDeclaration
  MethodDeclaration
  FunctionExpression
  ArrowFunction
*/