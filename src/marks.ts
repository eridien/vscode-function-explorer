import vscode      from 'vscode';
import ts          from "typescript";
import {Banner}    from './banners';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mark');

// const LOAD_MARKS_ON_START = true;
const LOAD_MARKS_ON_START = false;

const VERIFY_MARKS_IN_DUMP = true;
// const VERIFY_MARKS_IN_DUMP = false;

let context: vscode.ExtensionContext;
let initFinished = false;

async function init(contextIn: vscode.ExtensionContext) {
  start('init marks');
  context = contextIn;
  await loadMarkStorage();
  initFinished = true;
  end('init marks');
}

function waitForInit() {
  if (initFinished) return Promise.resolve();
  return new Promise((resolve: ) => {
    const checkInit = () => {
      if (initFinished) { resolve(); } 
      else { setTimeout(checkInit, 50); }
    };
    checkInit();
  });
}


export class Mark {
  start:     number;
  nameStart: number;
  name:      string;
  nameEnd:   number;
  end:       number;
  kind:      string;
  fsPath:    string;
  parents?:  Mark[];
  id?:       string;
  banner?:   Banner;
  document?: vscode.TextDocument;
  constructor(node: ts.Node, 
              document: vscode.TextDocument, kindIn?: string) {
    this.start     = node.getStart();
    this.nameStart = (node as any).name.getStart();
    this.name      = (node as any).name.text;
    this.nameEnd   = (node as any).name.getEnd();
    this.end       = node.getEnd();
    this.kind      = kindIn ?? ts.SyntaxKind[node.kind];
    this.fsPath    = document.uri.fsPath;
    if(this.start != this.nameStart) debugger; // debug
  }
  setParents(parents: Mark[]) {
    this.parents = parents;
  }
  setId(id: string) {
    this.id = id;
  }
  setBanner(banner: Banner) {
    this.banner = banner;
  }
  async getDocument() {
    if(this.document) return this.document;
    const uri = vscode.Uri.file(this.fsPath);
    this.document = await vscode.workspace.openTextDocument(uri);
    return this.document;
  }
}

let marksById:       Map<string, Mark>      = new Map();
let markSetByFsPath: Map<string, Set<Mark>> = new Map();

function addMarkToStorage(mark: Mark) {
  if(mark.id) {marksById.set(mark.id, mark);
  let markSet = markSetByFsPath.get(mark.fsPath);
  if (!markSet) {
    markSet = new Set();
    markSetByFsPath.set(mark.fsPath, markSet);
  }
  markSet.add(mark);
}

export async function getMarks(document: vscode.TextDocument) {
  start('getMarks');
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
      if(parentMark.start > mark.start) break;
      if(parentMark.end  >= mark.end) parents.unshift(parentMark);
    }
    mark.setParents(parents);
    let id = "";
    for(let parent of parents) {
      id += parent.name + "\x00" +
            parent.kind + "\x00" +
            parent.fsPath;
    }
    mark.setId(id);
    addMarkToStorage(mark);
    await saveMarkStorage();
  }
  end('getMarks', false);
}

function getMarksByFsPath(fsPath: string) {
  const fileMarkSet = markSetByFsPath.get(fsPath);
  if (fileMarkSet) return Array.from(fileMarkSet);
  return [];  
}

function getAllMarks() {
  return [...marksById.values()];
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
  let markSet = markSetByFsPath.get(mark.fsPath);
  if (markSet) {
    markSet.delete(mark);
    if(markSet.size === 0) markSetByFsPath.delete(mark.fsPath);
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

async function verifyMark(mark: Mark): Promise<boolean> {
  if(!mark) return false;
  const document      = await mark.getDocument();
  const markStartLine = document.positionAt(mark.start).line;
  const numLines      = document.lineCount;
  if(markStartLine < 0 || markStartLine >= numLines) {
    log('err', 'verifyMark, line number out of range',
                mark.fsPath, markStartLine);
    return false;
  }
  const lineText = document.lineAt(markStartLine).text;
  if(!lineText) {
    log('err', 'verifyMark, line text is empty',
                mark.fsPath, markStartLine);
    return false;
  }
  if(!lineText.includes(mark.name)) {
    log('err', 'verifyMark, line text does not include mark name',
                mark.fsPath, markStartLine, mark.name);
    return false;
  }
  return true;
}

async function dumpMarks(caller, list, dump) {
  caller = caller + ' marks: ';
  let marks = Array.from(marksById.values());
  if(marks.length === 0) {
    log(caller, '<no marks>');
    return;
  }
  if(dump) log(caller, 'all marks', marks);
  else if(list) {
    marks.sort((a, b) => ( 
      a.locStrLc() > b.locStrLc() ? +1 :
      a.locStrLc() < b.locStrLc() ? -1 : 0));
    let str = "\n";
    for(const mark of marks) {
      if(VERIFY_MARKS_IN_DUMP) await verifyMark(mark);
      str += `${utils.tokenToStr(mark.token())} -> ${mark.fileRelUriPath()} ` +
             `${mark.lineNumber().toString().padStart(3, ' ')} `+
             `${mark.languageId()}\n`;
    }
    log(caller, str.slice(0,-1));
  }
  else {
    let str = "";
    for(const mark of marks) {
      if(VERIFY_MARKS_IN_DUMP) await verifyMark(mark);
      const tokenStr = utils.tokenToStr();
      const tokenIsZero = tokenStr.length == 4 && 
            tokenStr.slice(-2, -1) == '\u200B';
      str += mark.lineNumber().toString().padStart(3, ' ') + 
                               (tokenIsZero ? '' : utils.tokenToStr());
    }
    log(caller, str);
  }
}

let uniqueTokenNum = 0;

function getToken(document, zero = true) {
  const [commLft, commRgt] = utils.commentsByLang(document.languageId);
  return commLft + utils.numberToInvBase4(zero ? 0 : ++uniqueTokenNum) + '.'
       + commRgt;
}

async function addGen2MarkToLine(document, lineNumber, token, save = true) {
  start('addGen2MarkToLine', lineNumber);
  token ??= getToken(document);
  let lineText = document.lineAt(lineNumber).text;
  const mark = new Mark({gen:2, document, lineNumber, token,
                         lftChrOfs: lineText.length,
                         rgtChrOfs: lineText.length + token.length});
  await addMarkToStorage(mark);
  await utils.replaceLine(document, lineNumber, lineText + token);
  if(save) await saveMarkStorage();
  end('addGen2MarkToLine', lineNumber);
}

async function addGen2MarkForToken(document, position, token, save = true) {
  const mark = new Mark({gen:2, document, position, token});
  await addMarkToStorage(mark);
  if(save) await saveMarkStorage();
  return mark;
}

module.exports = {init, Mark, waitForInit, dumpMarks, getAllMarks, verifyMark,
                  getMarksFromLine, getMarksInFile, getMarkByTokenRange, 
                  deleteAllMarksFromFile, deleteMark, getDocument,
                  saveMarkStorage, addMarkToStorage, 
                  getToken, addGen2MarkToLine, addGen2MarkForToken };



/*
kinds supported ...
  FunctionDeclaration
  ClassDeclaration
  MethodDeclaration
  FunctionExpression
  ArrowFunction
*/