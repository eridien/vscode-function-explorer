// @@ts-nocheck
// https://github.com/acornjs/acorn/tree/master/acorn-loose/
// https://github.com/acornjs/acorn/tree/master/acorn-walk/

import vscode       from 'vscode';
import * as acorn   from "acorn-loose";
import * as walk    from 'acorn-walk';
import {settings}   from './settings';
import * as sett    from './settings';
import {Mark, Item} from './classes';
import * as utils   from './utils.js';
import { updateSide } from './commands';
const {log, start, end} = utils.getLog('mrks');

const LOAD_MARKS_ON_START = true;
// const LOAD_MARKS_ON_START = false;

const VERIFY_MARKS_IN_DUMP = true;
// const VERIFY_MARKS_IN_DUMP = false;

let context: vscode.ExtensionContext;

export async function activate(contextIn: vscode.ExtensionContext) {
  start('activate marks');
  context = contextIn;
  await loadMarkStorage();
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath))
    await updateSide({forceRefreshAll: true});
  end('activate marks');
}

let marksById:     Map<string, Mark> = new Map();
let marksByFsPath: Map<string, Map<string, Mark>> = new Map();

export function setMarkInMaps(mark: Mark): boolean {
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
  return !oldMark || !mark.equalsPos(oldMark);
}

let lastMarkName: Mark | null = null;

export async function updateMarksInFile(
                document: vscode.TextDocument | null = null) :
                Promise<Mark[] | undefined> {
  start('updateMarksInFile');
  const updatedMarks: Mark[] = [];
  if(!document) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) document = activeEditor.document;
  }
  if(!document) return [];
  const uri = document.uri;
  if(uri.scheme !== 'file' || 
    !sett.includeFile(uri.fsPath)) return [];
  const docText = document.getText();
  if (!docText || docText.length === 0) return [];
  const docMarks = marksByFsPath.get(document.uri.fsPath);
  for (const mark of (docMarks ? docMarks.values() : [])) 
    mark.missing = true;
  let ast: any;
  try{
      ast = acorn.parse(docText, { ecmaVersion: 'latest' });
  } catch (err) {
    log('err', 'parse error', (err as any).message);
    return undefined;
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
    if(setMarkInMaps(mark)) updatedMarks.push(mark);
  }
  await saveMarkStorage();
  const indexesToRemove = new Set<number>();
  for(const mark1 of updatedMarks) {
    updatedMarks.forEach((mark2, idx) => {
      if(mark1.id !== mark2.id &&
         mark2.getFsPath().startsWith(mark1.getFsPath())) 
        indexesToRemove.add(idx);
    });
  }
  const idxs = Array.from(indexesToRemove);
  idxs.sort((a, b) => b - a);
  for(const idx of idxs) updatedMarks.splice(idx, 1);
  end('updateMarksInFile', false);
  return updatedMarks;
}

export async function updateMarksInAllFiles() {
  for (const file of await sett.getAllFiles()) {
    const document = await vscode.workspace.openTextDocument(file);
    await updateMarksInFile(document);
  }
}

export function getMarks(p: any | {} = {}) : Mark[] {
  const {enabledOnly = false, includeMissing = false, fsPath} = p;
  let marks;
  if(fsPath) {
    const fileMarkMap = marksByFsPath.get(fsPath);
    if (!fileMarkMap) return [];
    marks = Array.from(fileMarkMap.values());
  }
  else marks = [...marksById.values()];
  if(enabledOnly)     marks = marks.filter(mark =>  mark.enabled);
  if(!includeMissing) marks = marks.filter(mark => !mark.missing);
  return marks;
}

function sortKeyAlpha(a: Mark) {
  return a.getFsPath() + "\x00" + a.name;
}

export function getSortedMarks(p: any = {}) : Mark[] {
  const {fsPath, reverse = false, alpha = false} = p;
  const marks = getMarks(p);
  if(marks.length === 0) return [];
  if (!fsPath) {
    if (alpha) {
      return marks.sort((a, b) => {
        if (sortKeyAlpha(a) > sortKeyAlpha(b)) return reverse? -1 : +1;
        if (sortKeyAlpha(a) < sortKeyAlpha(b)) return reverse? +1 : -1;
        return 0;
      });
    }
    return marks.sort((a, b) => {
      if (a.getStartKey() > b.getStartKey()) return reverse? -1 : +1;
      if (a.getStartKey() < b.getStartKey()) return reverse? +1 : -1;
      return 0;
    });
  } 
  if (alpha) {
    if(reverse)
      return marks.sort((a, b) => b.name.localeCompare(a.name));
    return marks.sort((a, b) => a.name.localeCompare(b.name));
  }
  return marks.sort((a, b) =>
    reverse? b.start - a.start : a.start - b.start
  );
}

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

export function markItemClick(item:any) {
  log('markItemClick', item);
}
