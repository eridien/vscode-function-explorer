import * as vscode from 'vscode';
import * as mrks   from './marks';
import * as gutt   from './gutter';
import {Mark}      from './marks';
import * as sett   from './settings';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export async function toggle() {
  log('toggle');
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  let enable:        boolean | null = null;
  let firstMark:     Mark    | null = null;
  let minMarkStart = Number.MAX_SAFE_INTEGER;
  for (const selection of editor.selections) {
    let topLine = selection.active.line;
    let botLine = selection.anchor.line;
    let marks: Mark[] = [];
    const fsPath = document.uri.fsPath;
    if(topLine === botLine) {
      const mark = mrks.getMarkAtLine(fsPath, topLine);
      if(mark) marks = [mark];
    }
    else {
      if(topLine > botLine) [topLine, botLine] = [botLine, topLine];
      marks = mrks.getMarksBetweenLines(fsPath, topLine, botLine, true);
    }
    if(marks.length === 0) return;
    if(enable === null) {
      let enabledCount = 0;
      marks.forEach(mark => { if(mark.enabled) enabledCount++; });
      enable = enabledCount/marks.length < 0.5;
    }
    marks.forEach(mark => {
      mark.setEnabled(enable!);
      if(enable && mark.start < minMarkStart) {
        minMarkStart = mark.start;
        firstMark    = mark;
      }
    });
  }
  gutt.updateGutter(editor);
  await mrks.saveMarkStorage();
  if(firstMark) await mrks.revealMark(firstMark);
}

export function prev() {
  log('prev');
}

export function next() {
  log('next');
}

export async function editorChg(editor: vscode.TextEditor) {
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await mrks.updateMarksInFile(document);
  gutt.updateGutter(editor);
}
