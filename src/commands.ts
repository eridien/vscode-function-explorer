import * as vscode from 'vscode';
import * as symb   from './symbols';
import * as parse  from './parse';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export function toggle() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  // const cursPos = editor.selection.active;
  log(parse.getFuncs(editor.document));
}
