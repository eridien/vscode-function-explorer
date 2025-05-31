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
  document:   vscode.TextDocument;
  name:       string;
  kind:       string;
  start:      number;
  nameStart:  number;
  nameEnd:    number;
  end:        number;
  parents?:   Mark[];
  id?:        string;
  startLine?: number;
  endLine?:   number;
  startKey?:  string;
  endKey?:    string;
  enabled:    boolean;
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
  getStartLine() {
    if (this.startLine === undefined) 
        this.startLine = this.document.positionAt(this.start).line;
    return this.startLine;
  }
  getEndLine() {
    if (this.endLine === undefined) {
      const endPos = this.document.positionAt(this.end);
      this.endLine = endPos.line;
      if (endPos.character > 0) this.endLine++;
    }
    return this.endLine;
  }
  getStartKey() {
    if (this.startKey === undefined) 
        this.startKey = this.document.uri.fsPath + "\x00" + 
                        this.getStartLine().toString().padStart(6, '0');
    return this.startKey;
  }
  getEndKey() {
    if (this.endKey === undefined) 
        this.endKey = this.document.uri.fsPath + "\x00" + 
                      this.getEndLine().toString().padStart(6, '0');
    return this.endKey;
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

export function getAllMarks(enabled = false) {
  const marks = [...marksById.values()];
  if(enabled) return marks.filter(mark => mark.enabled);
  return marks;
}

export function getMarksByFsPath(fsPath: string, enabled = false) : Mark[] {
  const fileMarkSet = markSetByFsPath.get(fsPath);
  if (fileMarkSet) return Array.from(fileMarkSet);
  return [];  
}

export function getSortedMarks(document: vscode.TextDocument | null = null, 
                               reverse = false, enabled = false) : Mark[] {
  if (document === null) {
    const marks = getAllMarks();
    if(marks.length === 0) return [];
    return marks.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return reverse? -1 : +1;
      if (a.getStartKey() < b.getStartKey()) return reverse? +1 : -1;
      return 0;
    });
  } 
  const marks = getMarksByFsPath(document.uri.fsPath);
  return marks.sort((a, b) => reverse? b.start - a.start 
                                     : a.start - b.start);
}

export function getMarkAtLine( document: vscode.TextDocument, 
                               lineNumber: number) : Mark | null {
  const marks = getSortedMarks(document);
  if (marks.length === 0) return null;
  let match: Mark | null = null;
  for(const mark of marks) {
    if(mark.getStartLine() > lineNumber) return match;
    if(mark.getEndLine()   > lineNumber) match = mark;
  }
  return match;
}

export function getMarksBetweenLines( document: vscode.TextDocument, 
                      startLine: number, endLine: number) : Mark[] {
  const marks = getSortedMarks(document);
  if (marks.length === 0) return [];
  let matches: Mark[] = [];
  let curLine = startLine;
  for(const mark of marks) {


  
    if(mark.getStartLine() > endLine) return matches;
    if(mark.getEndLine()   > startLine) matches.push(mark);
  }
  return matches;
}

async function loadMarkStorage() {
  if(LOAD_MARKS_ON_START) {
    const marks = context.workspaceState.get('marks', []);
    for (const mark of marks) addMarkToStorage(mark);
  }
  await saveMarkStorage();
}
/*
Default                   // Reveal with minimal scrolling
InCenter                  // Reveal in the center of the viewport
InCenterIfOutsideViewport // Center only if not visible
AtTop                     // Reveal at the top of the viewport
*/
export async function revealMark(mark: Mark, selection = false) {
  const editor = await vscode.window.showTextDocument(
                          mark.document, { preview: false });
  const position = mark.document.positionAt(mark.start);
  editor.revealRange(
    new vscode.Range(position, position),
        vscode.TextEditorRevealType.Default
  );
  if(selection) 
    editor.selection = new vscode.Selection(position, position);
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

function verifyMark(mark: Mark): boolean {
  if(!mark || !mark.document) return false;
  const document      = mark.document;
  const markStartLine = mark.getStartLine();
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