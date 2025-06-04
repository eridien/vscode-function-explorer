import * as vscode from 'vscode';
import * as mrks   from './marks';
import {Mark}      from './marks';
import * as sett   from './settings';
import {settings}  from './settings';
import * as gutt   from './gutter';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export async function toggle() {
  log('toggle');
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const document = editor.document;
  await mrks.updateMarksInFile(document);
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
// getStartKey() 
async function prevNext(next: boolean) {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && 
      activeEditor.document.uri.scheme === 'file' &&
      sett.includeFile(activeEditor.document.uri.fsPath)) {
    const fsPath   = activeEditor.document.uri.fsPath;
    const fileWrap = settings.fileWrap;
    const sortArgs = {enabledOnly: true};
    if(!fileWrap) (sortArgs as any).fsPath = fsPath;
    const marks = mrks.getSortedMarks(sortArgs);
    if(marks.length == 0) return;
    const selFsPath = (fileWrap ? fsPath : '');
    const selKey = mrks.createSortKey(
          selFsPath, activeEditor.selection.active.line);
    let mark: Mark;
    for(let i = (next? 0 : marks.length-1); 
           (next? (i < marks.length) : (i >= 0)); 
            i += (next? 1 : -1)) {
      mark = marks[i];
      const markFsPath = (fileWrap ? mark.getFsPath() : '');
      if(next ? (markFsPath < selFsPath) 
              : (markFsPath > selFsPath)) continue;
      if(markFsPath !== selFsPath) break;
      const markKey = mrks.createSortKey(
            markFsPath, mark.getStartLine());
      if(next) {
        if(selKey < markKey) break;
        else if(i == marks.length-1) {
          mark = marks[0];
          break;
        }
      }
      else {
        if(selKey > markKey) break;
        else if(i == 0) {
          mark = marks[marks.length-1];
          break;
        }
      }
    }
    await mrks.revealMark(mark!, true);
  }
}

export async function prev() { await prevNext(false); }

export async function next() { await prevNext(true); }

export async function editorChg(editor: vscode.TextEditor) {
  const document = editor.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await mrks.updateMarksInFile(document);
  gutt.updateGutter(editor);
}

export async function textChg(event :vscode.TextDocumentChangeEvent) {
  const document = event.document;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(document.uri.fsPath)) return;
  await mrks.updateMarksInFile(document);
  gutt.updateGutter(vscode.window.activeTextEditor!);
}
