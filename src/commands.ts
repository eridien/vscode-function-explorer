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
  if (!editor) return;
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  let topLine = editor.selection.active.line;
  let botLine = editor.selection.anchor.line;
  await mrks.updateMarks(document);
  let marks: Mark[] = [];
  if(topLine === botLine) {
    const mark = mrks.getMarkAtLine(document, topLine);
    if(mark) marks = [mark];
  }
  else {
    if(topLine > botLine) [topLine, botLine] = [botLine, topLine];
    marks = mrks.getMarksBetweenLines(document, topLine, botLine);
  }
  if(marks.length === 0) return;
  let enabledCount = 0;
  marks.forEach(mark => { if(mark.enabled) enabledCount++; });
  const enable = enabledCount/marks.length < 0.5;
  marks.forEach(mark => mark.setEnabled(enable));
  gutt.updateGutter(editor);
  await mrks.revealMark(marks[0]);
}

export function prev() {
  log('prev');
}

export function next() {
  log('next');
}
