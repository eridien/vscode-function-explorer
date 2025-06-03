// @@ts-nocheck

import vscode      from 'vscode';
import { parse }   from "@babel/parser";
import traverse    from "@babel/traverse";
import {settings}  from './settings';
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

export async function initMarks() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor &&
      activeEditor.document.uri.scheme === 'file' &&
     (activeEditor.document.languageId === 'javascript' || 
      activeEditor.document.languageId === 'typescript'))
    await updateMarksInFile(activeEditor.document);
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
  constructor(p:any) {
    const {document, name, type, start, end} = p;
    this.document  = document;
    this.name      = name;
    this.type      = type;
    this.start     = start;
    this.end       = end;
    this.enabled   = false;
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

let lastMarkName: Mark | null = null;

// does not filter
export async function updateMarksInFile(document: vscode.TextDocument) {
  start('updateMarksInFile');
  const docText = document.getText();
  if (!docText || docText.length === 0) return;
  let ast: any;
  try{
    ast = parse(docText, { 
      errorRecovery: true, plugins: ['typescript'], 
      sourceType: "module", tokens: false,
    });
  } catch (err) {
    log('errMsg', err, 'Function Marks: Parse error');
    return;
  }
  const marks: Mark[] = [];
  traverse(ast, {
    enter(path) {
      if (path.isVariableDeclarator() &&
          path.node.init && 
          path.node.init.type.indexOf('Function') !== -1) {
        const start = path.node.start;
        const idEnd = path.node.id.end;
        const end   = path.node.end;
        const name  = docText.slice(start!, idEnd!);
        const type  = path.node.init.type;
        marks.push(new Mark({document, name, type, start, end}));
        return;
      }
      if (path.isFunctionDeclaration()) {
        const name  = (path.node.id as any).name;
        const type  = 'FunctionDeclaration';
        const start = path.node.start;
        const end   = path.node.end;
        marks.push(new Mark({document, name, type, start, end}));
        return;
      }
      if (path.isAssignmentExpression() &&
          path.node.right.type.indexOf('Function') !== -1) {
        const left  = path.node.left;
        const right = path.node.right;
        const name  = docText.slice(left.start!, left.end!);
        const type  = right.type;
        const start = left.start;
        const end   = right.end;
        marks.push(new Mark({document, name, type, start, end}));
        return;
      }
      if (path.isClassMethod()) {
        let type:string;
        let parentPath:any = path;
        while((parentPath = parentPath.parentPath) &&
              !parentPath.isClassDeclaration());
        if (!parentPath || !parentPath.isClassDeclaration()) {
          log('err', 'method without class declaration');
          return;
        }
        let name = parentPath.node.id.name + '.';
        if(path.node.kind == 'constructor') {
          name += 'constructor';
          type  = 'Constructor';
        }
        else {
          name += (path.node.key as any).name;
          type  = 'Method';
        }
        const start = path.node.start;
        const end   = path.node.end;
        marks.push(new Mark({document, name, type, start, end}));
        return;
      }
    },
  });
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
