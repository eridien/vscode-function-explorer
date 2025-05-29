const vscode = require('vscode');
const utils  = require('./utils.js');
const {log, start, end} = utils.getLog('mark');

// const LOAD_MARKS_ON_START = true;
const LOAD_MARKS_ON_START = false;

const VERIFY_MARKS_IN_DUMP = true;
// const VERIFY_MARKS_IN_DUMP = false;

let context;
let initFinished = false;

async function init(contextIn) {
  start('init marks');
  context = contextIn;
  await loadMarkStorage();
  initFinished = true;
  await utils.refreshAllLoadedDocs();
  end('init marks');
}

class Mark {
  constructor(p) {
    const o = {};
    if(p.gen === undefined)
            throw new Error('Mark constructor: missing gen');
    o._gen = p.gen;
    if(p._gen == 2 && p.token === undefined)
            throw new Error('Mark constructor: missing token');
    o._token = p.token;
    function pos() { return p.position ?? p.pos ?? p.range?.start ?? 
                            p.location?.range?.start ?? p.loc?.range?.start }
    o._fileFsPath = p.fsPath ?? p.document?.uri?.fsPath ?? 
                    p.doc?.uri?.fsPath ?? p.fileFsPath ?? p.uri?.fsPath ?? 
                    p.fileUri?.fsPath ?? p.location?.uri?.fsPath ?? 
                    p.loc?.uri?.fsPath;
    o._lineNumber = p.lineNumber ?? p.linNum ?? p.line ?? pos()?.line;
    if(o._gen == 2) {
      o._lftChrOfs = p.lftChrOfs ?? pos()?.character;
      o._rgtChrOfs = p.rgtChrOfs ?? o._lftChrOfs + o._token.length;
    }
    else {o._lftChrOfs = o._rgtChrOfs = 0; }
    if(o._fileFsPath === undefined || o._lineNumber === undefined || 
          (o._gen == 2 ? (o._lftChrOfs === undefined || 
                ! (typeof o._rgtChrOfs === 'number')) : false)) {
      throw new Error('Mark constructor: missing param');
    }
    Object.assign(this, o);
  }
  fileFsPath()     { return this._fileFsPath }
  lineNumber()     { return this._lineNumber }
  lftChrOfs()      { return this._lftChrOfs  }
  rgtChrOfs()      { return this._rgtChrOfs  }
  token()          { return this._token      }
  gen()            { return this._gen        }

  range()          {return this._range ??=
                            new vscode.Range(this._lineNumber, this._lftChrOfs,
                                             this._lineNumber, this._rgtChrOfs) }
  fileUri()        { return this._fileUri ??= 
                         vscode.Uri.file(this._fileFsPath) };
  fileFsPath()     { return this._fileFsPath  ??= this.fileUri().fsPath }
  fileUriPath()    { return this._fileUriPath ??= this.fileUri().path }

  wsFolder()       { return this._wsFolder ??= 
                        vscode.workspace.getWorkspaceFolder(this.fileUri()) }
  folderIdx()      { return this._folderIdx      ??= this.wsFolder().index  }
  folderUri()      { return this._folderUri      ??= this.wsFolder().uri }  
  folderName()     { return this._folderName     ??= this.wsFolder().name; }
  folderFsPath()   { return this._folderFsPath   ??= this.folderUri().fsPath }
  folderUriPath()  { return this._folderUriPath  ??= this.folderUri().path }
  fileRelUriPath() { return this._fileRelUriPath ??= 
                      this.fileUriPath().slice(this.folderUriPath().length+1) }
  languageId()     { return this._languageId ??=
                             vscode.workspace.getLanguageMode(this.fileUri()) }
  locStr()         { return  this._locStr ??= 
                             getLocStr(this._fileFsPath, this._lineNumber, 
                                       this._lftChrOfs,  this._rgtChrOfs ) }
  locStrLc()       { return this._locStrLc ??= this.locStr().toLowerCase() }

  toObj() {
    return {fileFsPath: this._fileFsPath, token: this._token, 
            lineNumber: this._lineNumber,   gen: this._gen,
            lftChrOfs:  this._lftChrOfs, 
            rgtChrOfs:  this._rgtChrOfs};
  }
}

function getLocStr(fileFsPath, lineNumber, lftChrOfs, rgtChrOfs) {
  return fileFsPath + '\x00' + lineNumber.toString().padStart(6, '0') + 
                      '\x00' + lftChrOfs .toString().padStart(6, '0') + 
                      '\x00' + rgtChrOfs .toString().padStart(6, '0');
}

async function getDocument(mark) { 
  return await vscode.workspace.openTextDocument(mark.fileUri());
}

let marksByLocStr       = new Map(); 
let markSetByToken      = new Map();
let markSetByFileFsPath = new Map();

async function addMarkToStorage(mark, save = true) {
  marksByLocStr.set(mark.locStr(), mark);
  let tokenMarkSet = markSetByToken.get(mark.token());
  if (!tokenMarkSet) {
    tokenMarkSet = new Set();
    markSetByToken.set(mark.token(), tokenMarkSet);
  }
  tokenMarkSet.add(mark);
  let fileMarkSet = markSetByFileFsPath.get(mark.fileFsPath());
  if (!fileMarkSet) {
    fileMarkSet = new Set();
    markSetByFileFsPath.set(mark.fileFsPath(), fileMarkSet);
  }
  fileMarkSet.add(mark);
  if(save) await saveMarkStorage();
}

async function loadMarkStorage() {
  if(!LOAD_MARKS_ON_START) {
    await saveMarkStorage();
    return;
  }
  const marks = context.workspaceState.get('marks', []);
  for (const markObj of marks) {
    const mark = new Mark(markObj);
    await addMarkToStorage(mark, false);
  }
}

async function saveMarkStorage() {
  const markObjects =  [...marksByLocStr.values()]
                          .map(mark => mark.toObj());
  await context.workspaceState.update('marks', markObjects);
}

async function getMarkByTokenRange(document, range) {
  const fileFsPath = document.uri.fsPath;
  const lineNumber = range.start.line;
  const lftChrOfs  = range.start.character;
  const rgtChrOfs  = range.end.character;
  const markSet = markSetByFileFsPath.get(fileFsPath);
  if (!markSet) return null;
  for (const mark of markSet) {
    if (mark.lineNumber() !== lineNumber) continue;
    if (mark.lftChrOfs()  !== lftChrOfs)  continue;
    if (mark.rgtChrOfs()  !== rgtChrOfs)  continue;
    return mark;
  }
  return null;
}

function getMarksInFile(fileFsPath) {
  const fileMarkSet = markSetByFileFsPath.get(fileFsPath);
  if (fileMarkSet) return Array.from(fileMarkSet);
  return [];  
}

function getAllMarks() { 
  return [...marksByLocStr.values()]; 
}

function deleteMarkFromFileSet(mark) {
  let fileMarkSet = markSetByFileFsPath.get(mark.fileFsPath());
  if (fileMarkSet) {
    fileMarkSet.delete(mark);
    if(fileMarkSet.size === 0) markSetByFileFsPath.delete(mark.fileFsPath());
  }
}

function deleteMarkFromTokenSet(mark) {
  if(mark.gen() === 1) return;
  let tokenMarkSet = markSetByToken.get(mark.token());
  if (tokenMarkSet) {
    tokenMarkSet.delete(mark);
    if (tokenMarkSet.size === 0) markSetByToken.delete(mark.token());
  }
}

async function deleteTokenFromLine(mark) {
  const lineNumber = mark.lineNumber();
  const document   = await getDocument(mark);
  const line       = document.lineAt(lineNumber);
  if(!line || !await verifyMark(mark)) return;
  const lftChrOfs  = mark.lftChrOfs();
  const rgtChrOfs  = mark.rgtChrOfs();
  let lineText     = line.text;
  lineText = lineText.slice(0, lftChrOfs) + lineText.slice(rgtChrOfs);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, lineText);
  await vscode.workspace.applyEdit(edit);
}

async function deleteMark(mark, save = true, update = true) {//​.
  marksByLocStr.delete(mark.locStr());
  await deleteMarkFromFileSet(mark);  
  await deleteMarkFromTokenSet(mark);  
  await deleteTokenFromLine(mark);
  if(save) await saveMarkStorage();
  if(update) utils.updateSide(); 
  //await dumpMarks('deleteMark');
}

async function deleteAllMarksFromFile(document, update = true) {//​.
  const fileMarks = getMarksInFile(document.uri.fsPath);
  if(fileMarks.length === 0) return;
  log('deleteAllMarksFromFile', utils.getFileRelUriPath(document));
  for (const mark of fileMarks) await deleteMark(mark, false, false);
  await saveMarkStorage();
  if(update) utils.updateSide();
}

function waitForInit() {
  if (initFinished) return Promise.resolve();
  return new Promise((resolve) => {
    const checkInit = () => {
      if (initFinished) { resolve(); } 
      else { setTimeout(checkInit, 50); }
    };
    checkInit();
  });
}

function getMarksFromLine(document, lineNumber, sort = false) {
  const fileMarks = getMarksInFile(document.uri.fsPath);
  if(fileMarks.length === 0) return [];
  const lineMarks = fileMarks.filter(mark => mark.lineNumber() === lineNumber);
  if (sort) {
    lineMarks.sort((a, b) => {
      if (a.locStrLc() > b.locStrLc()) return +1;
      if (a.locStrLc() < b.locStrLc()) return -1;
      return 0;
    });
  }
  return lineMarks;
}

async function verifyMark(mark) {
  if(!mark) return false;
  const document   = await vscode.workspace.openTextDocument(mark.fileUri());
  const lineNumber = mark.lineNumber();
  const numLines   = document.lineCount;
  if(lineNumber < 0 || lineNumber >= numLines) {
    log('err', 'verifyMark, line number out of range',
                mark.fileRelUriPath(), lineNumber);
    return false;
  }
  if(mark.gen() === 1 || await utils.getHiddenFolder()) return true;
  if(document.getText(mark.range()) != mark.token()) {
    log('err', 'verifyMark, token missing from line',
                mark.fileRelUriPath(), lineNumber);
    return false; 
  }
  return true;
}

async function dumpMarks(caller, list, dump) {
  caller = caller + ' marks: ';
  let marks = Array.from(marksByLocStr.values());
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



