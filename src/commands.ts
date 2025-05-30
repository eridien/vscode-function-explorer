import * as vscode from 'vscode';
import * as mrks   from './marks';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export async function toggle() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  // const cursPos = editor.selection.active;
  const document = editor.document;
  if (document.uri.scheme !== 'file'||
     (document.languageId !== 'javascript' && 
      document.languageId !== 'typescript'))
    return;
  await mrks.getMarks(document);
  log('marks', mrks.getAllMarks()[2]);
}
