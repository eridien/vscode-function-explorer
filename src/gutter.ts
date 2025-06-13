import * as vscode from 'vscode';
import * as path   from 'path';
import * as fnct   from './funcs';
import * as utils  from './utils';
const {log} = utils.getLog('gutt');

let context:      vscode.ExtensionContext;
let gutDecLgtUri: vscode.Uri;
let gutDecDrkUri: vscode.Uri;
let gutterDec:    vscode.TextEditorDecorationType;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  gutDecLgtUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-lgt.svg'));
  gutDecDrkUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-drk.svg'));
  gutterDec = getGutterDec();
}

function getGutterDec() {
  return vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    light: { gutterIconPath: gutDecLgtUri},
    dark:  { gutterIconPath: gutDecDrkUri}
  });
};

vscode.window.onDidChangeActiveColorTheme(() => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
  updateGutter();
});

export function updateGutter() {
  const activeEditor = vscode.window.activeTextEditor;
  if(!activeEditor) return;
  const document  = activeEditor.document;
  const fsPath    = document.uri.fsPath;
  const decRanges = [];
  const funcs     = fnct.getFuncs({filtered: true, fsPath});
  for(const func of funcs) {
    const lineNumber = document.positionAt(func.start).line;
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  }
  activeEditor.setDecorations(gutterDec, decRanges);
}
