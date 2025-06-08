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

vscode.window.onDidChangeActiveColorTheme((event) => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
});

export function updateGutter(editor: vscode.TextEditor | 
                                     undefined = undefined) {
  if(!editor) {
    const activeEditor = vscode.window.activeTextEditor;
    if(activeEditor) editor = activeEditor;
    else return;
  }
  const document  = editor.document;
  const decRanges = [];
  const fsPath    = document.uri.fsPath;
  const funcs     = fnct.getFuncs({markedOnly: true, fsPath});
  for(const func of funcs) {
    const lineNumber = document.positionAt(func.start).line;
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  }
  editor.setDecorations(gutterDec, decRanges);
}
