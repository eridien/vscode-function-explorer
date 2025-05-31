import * as vscode from 'vscode';
import * as mrks   from './marks';
import * as gutt   from './gutter';
import {Mark}      from './marks';
import {settings}  from './settings.js';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export async function toggle() {
  log('toggle');
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  const document = editor.document;
  await mrks.findAllMarks(document);
  if (document.uri.scheme !== 'file' ||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  const line = editor.selection.active.line;
  const mark = mrks.getMarkAtLine(document, line);
  if(!mark) return;
  mark.setEnabled(!mark.enabled);
  if(mark.document.uri.fsPath === document.uri.fsPath) {
    gutt.updateGutter(editor);
  }
  await mrks.revealMark(mark);
}

export function prev() {
  log('prev');
}

export function next() {
  log('next');
}
