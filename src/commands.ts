import * as vscode from 'vscode';
import * as mrks   from './marks';
import {Mark}      from './marks';
import {settings}  from './settings.js';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export function toggle() {
  log('toggle');
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  const document = editor.document;
  if (document.uri.scheme !== 'file'||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  const cursPos = editor.selection.active;
  const cursIdx = document.offsetAt(cursPos);
  let marks: Mark[];
  if (settings.fileWrap) {
    marks = mrks.getAllMarks();
    if(marks.length === 0) return;
    let currentMark: Mark | undefined;
    marks.sort((a, b) => {
      if (a.getSortKey() > b.getSortKey()) return +1;
      if (a.getSortKey() < b.getSortKey()) return -1;
      return 0;
    });
    const sortKey = document.uri.fsPath + "\x00" + 
                    cursIdx.toString().padStart(6, '0');
    currentMark = marks.find( mark => mark.getSortKey() <= sortKey && 
                                      mark.getSortKey() >= sortKey);
  } else {
    marks = mrks.getMarksByFsPath(document.uri.fsPath);
    if(marks.length === 0) return;
    marks.sort((a, b) => b.start - a.start);
  }

  // if (currentMark) {
  //   currentMark.enabled = !currentMark.enabled;
  //   await mrks.saveMarkStorage();
  // }

}

export function prev() {
  log('prev');
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  // const cursPos = editor.selection.active;
  const document = editor.document;
  if (document.uri.scheme !== 'file'||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  let marks = settings.fileWrap ? mrks.getAllMarks()
                                : mrks.getMarksByFsPath(document.uri.fsPath);
}

export function next() {
  log('next');
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  // const cursPos = editor.selection.active;
  const document = editor.document;
  if (document.uri.scheme !== 'file'||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  let marks = settings.fileWrap ? mrks.getAllMarks()
                                : mrks.getMarksByFsPath(document.uri.fsPath);
}
