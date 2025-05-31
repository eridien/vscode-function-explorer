import vscode      from 'vscode';
import ts          from "typescript";
import {settings}  from './settings';
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

let marksById:       Map<string, Mark>      = new Map();
let markSetByFsPath: Map<string, Set<Mark>> = new Map();

// does not filter
function addMarkToMapAndSet(mark: Mark) {
  const oldMark = marksById.get(mark.id!);
  if (oldMark) mark.setEnabled(oldMark.enabled);
  const fsPath = mark.getFsPath();
  marksById.set(mark.id!, mark);
  let markSet = markSetByFsPath.get(fsPath);
  if (!markSet) {
    markSet = new Set();
    markSetByFsPath.set(fsPath, markSet);
  }
  markSet.add(mark);
}

// does not filter
export async function updateMarksInFile(document: vscode.TextDocument) {
  start('updateMarksInFile');
  const sourceFile = ts.createSourceFile(
                              document.fileName, document.getText(), 
                              ts.ScriptTarget.Latest, true);
  const marks: Mark[] = [];
  function traverse(node: ts.Node) {
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
    id += mark.getFsPath();
    mark.setId(id);
    addMarkToMapAndSet(mark);
  }
  await saveMarkStorage();
  end('updateMarksInFile', false);
}

export async function updateAllMarks() {
  start('updateAllMarks');
  const documents = vscode.workspace.textDocuments;
  for(const document of documents) {
    if(document.uri.scheme !== 'file') continue;
    if(document.languageId !== 'javascript' && 
       document.languageId !== 'typescript') continue;
    await updateMarksInFile(document);
  }
  end('updateAllMarks', false);
}

// filters
export function getMarks(p: any | {} = {}) : Mark[] {
  const {enabledOnly = false, includeClasses = true, fsPath} = p;
  let marks;
  if(fsPath) {
    const fileMarkSet = markSetByFsPath.get(fsPath);
    if (!fileMarkSet) return [];
    marks = Array.from(fileMarkSet);
  }
  else marks = [...marksById.values()];
  if(enabledOnly)      marks = marks.filter(mark => mark.enabled);
  if(!includeClasses)  marks = marks.filter(
                       mark => mark.kind !== 'ClassDeclaration');
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
  return marks.sort((a, b) => reverse? b.start - a.start 
                                     : a.start - b.start);
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
                      startLine: number, endLine: number) : Mark[] {
  let marks = getSortedMarks({fsPath, 
                              includeClasses: settings.includeClasses});
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
      if(depth == minDepth) subMarks.push(mark);
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
      addMarkToMapAndSet(mark);
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
  let markSet = markSetByFsPath.get(mark.getFsPath());
  if (markSet) {
    markSet.delete(mark);
    if(markSet.size === 0) markSetByFsPath.delete(mark.getFsPath());
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
