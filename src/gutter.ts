import * as vscode from 'vscode';
import * as path   from 'path';
// import * as marks  from './marks';
import * as utils  from './utils';
const {log} = utils.getLog('gutt');

let context:      vscode.ExtensionContext;
let gutDecLgtUri: vscode.Uri;
let gutDecDrkUri: vscode.Uri;
let gutterDec:    vscode.TextEditorDecorationType;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  gutDecLgtUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'mark-icon-lgt.svg'));
  gutDecDrkUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'mark-icon-drk.svg'));
  gutterDec = getGutterDec();
}

function getGutterDec() {
  return vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    light: { gutterIconPath: gutDecLgtUri},
    dark:  { gutterIconPath: gutDecDrkUri}
  });
};

vscode.window.onDidChangeActiveColorTheme((event) => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
});

export function updateGutter() {
  // start('updateGutter');
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const fsPath      = editor.document.uri.fsPath;
  const decRanges   = [];
  // const marksInFile = marks.getMarksInFile(fsPath);
  // for(const mark of marksInFile) {
    const lineNumber = 1;
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  // }
  editor.setDecorations(gutterDec, decRanges);
}
