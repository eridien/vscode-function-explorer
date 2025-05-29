import * as vscode from 'vscode';
import * as parse  from './parse';
import * as lines  from './lines';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export function toggle() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  // const cursPos = editor.selection.active;
  const document = editor.document;
  if (document.uri.scheme !== 'file'||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  utils.initIdNumber(document);
  const funcs = parse.getFuncs(document);
  log('funcs', funcs);
  const funcLines = lines.getLines(document);
  log('funcLines', funcLines);
}
