// @@ts-nocheck

import vscode      from 'vscode';
import { parse }   from "@babel/parser";
import traverse    from "@babel/traverse";
import {settings}  from './settings';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mrks');


const code = `
class cname {
  constructor() {}
  mname() {}
}
function fname(){};
fexpr   = function(){};
fexpr.b = function(){};
arr   = () => {};
arr.b = () => {};
`;
const ast = parse(code, { errorRecovery: true, 
  createImportExpressions: true,
  plugins: ['typescript'], sourceType: "module",
  tokens: false,
});

traverse(ast, {
  enter(path) {
    if (path.isFunctionDeclaration()) {
      const name  = path.node.id!.name;
      const start = path.node.start;
      const end   = path.node.end;
      console.log('name:', name, '  start:', start, '  end:', end);
    }
    if (path.isAssignmentExpression() &&
        path.node.right.type.indexOf('Function') !== -1) {
      const left  = path.node.left;
      const right = path.node.right;
      const name  = code.slice(left.start!, left.end!);
      const start = left.start;
      const end   = right.end;
      console.log('name:', name, '  start:', start, '  end:', end);
    }
  },
});

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

export function initMarks() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor)
    updateMarksInFile(activeEditor.document);
}


export class Mark {
  document:       vscode.TextDocument;
  name:           string;
  kind:           string;
  start:          number;
  nameStart:      number;
  nameEnd:        number;
  end:            number;
  parents?:       Mark[];
  id?:            string;
  startLine?:     number;
  nameStartLine?: number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  fsPath?:        string;
  enabled:        boolean;
  constructor(node: any,
              document: vscode.TextDocument, kindIn: string) {
    this.document  = document;
    this.name      = (node as any).name.text;
    this.kind      = kindIn;
    this.start     = node.getStart();
    this.nameStart = (node as any).name.getStart();
    this.nameEnd   = (node as any).name.getEnd();
    this.end       = node.getEnd();
    this.parents   = [];
    this.id        = '';
    this.enabled   = false;
  }
  setParents(parents: Mark[]) { 
    this.parents = parents; 
    setMarkInMaps(this);
  }
  setId(id: string) {
    this.id = id;           
    setMarkInMaps(this);
  }
  setKind(kind: string) { 
   this.kind = kind;       
    setMarkInMaps(this);
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
  getNameStartLine() {
    if (this.nameStartLine === undefined) 
        this.nameStartLine = this.document.positionAt(this.nameStart).line;
    return this.nameStartLine;
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

let marksById:     Map<string, Mark> = new Map();
let marksByFsPath: Map<string, Map<string, Mark>> = new Map();

// does not filter
function setMarkInMaps(mark: Mark) {
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

// does not filter
export function updateMarksInFile(document: vscode.TextDocument) {
  start('updateMarksInFile');

  const ast = parse(document.getText(), { 
    errorRecovery: true, createImportExpressions: true,
    plugins: ['typescript'], sourceType: "module", tokens: false,
  });

  traverse(ast, {
    enter(path:any) {
      if (path.isIdentifier({ name: "n" })) {
        path.node.name = "x";
      }
    },
  });

  end('updateMarksInFile', false);
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
  if(enabledOnly) marks = marks.filter(mark => mark.enabled);
  return marks;
}

// filters
export function getSortedMarks(p: any | {} = {}) : Mark[] {
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
      if(depth < minDepth) minDepth = depth;
    }
    const subMarks = [];
    for(const mark of matches) {
      const depth = mark.parents!.length;
      if(depth == minDepth ||
        (overRideSubChk && mark.enabled)) subMarks.push(mark);
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
                          mark.document, { preview: false });
  const position = mark.document.positionAt(mark.start);
  editor.revealRange(
    new vscode.Range(position, position),
        vscode.TextEditorRevealType.Default
  );
  if(selection) 
    editor.selection = new vscode.Selection(position, position);
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
  const nameStartLine = mark.getNameStartLine();
  const numLines      = document.lineCount;
  if(nameStartLine < 0 || nameStartLine >= numLines) {
    log('err', 'verifyMark, line number out of range',
                mark.getFsPath(), nameStartLine);
    return false;
  }
  const lineText = document.lineAt(nameStartLine).text;
  if(!lineText) {
    log('err', 'verifyMark, line text is empty',
                mark.getFsPath(), nameStartLine);
    return false;
  }
  if(!lineText.includes(mark.name)) {
    log('err', 'verifyMark, line text does not include mark name',
                mark.getFsPath(), nameStartLine, mark.name);
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
