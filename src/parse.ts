import * as vscode from 'vscode';
import * as ts from "typescript";
import * as utils  from './utils';
const {log} = utils.getLog('pars');

class Func {
  name:       string;
  kind:       string;
  lineNumber: number;
  labeled:    boolean;
  constructor(node: ts.Node, document: vscode.TextDocument, 
                             kindIn?: string) {
    // @ts-expect-error
    this.name  = node!.name.text;
    this.kind  = kindIn ?? ts.SyntaxKind[node.kind];
    this.lineNumber = document.positionAt(node.getStart()).line;
    this.labeled = false;
  }
}

export function getFuncs( document: vscode.TextDocument) : Func[] {
  const sourceFile = ts.createSourceFile(
              document.fileName, document.getText(), 
              ts.ScriptTarget.Latest, true);
  const funcs: Func[] = [];
  function traverse(node: ts.Node) {
    if((ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)    ||
        ts.isMethodDeclaration(node)) && node.name)
          funcs.push(new Func(node, document));
    else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isFunctionExpression(node.initializer))
        funcs.push(new Func(node, document, 'FunctionExpression'));
      else if (ts.isArrowFunction(node.initializer))
        funcs.push(new Func(node, document, 'ArrowFunction'));
    }
    ts.forEachChild(node, traverse);
  }
  traverse(sourceFile);
  return funcs;
}
