import * as vscode from 'vscode';
import * as ts from "typescript";
import * as utils  from './utils';
const {log} = utils.getLog('pars');

class Func {
  name:     string;
  kind:     string;
  document: vscode.TextDocument;
  startPos: vscode.Position;
  endPos:   vscode.Position;
  markId:  number | null;
  constructor(node: ts.Node, 
              document: vscode.TextDocument, kindIn?: string) {
    this.name     = (node as any).name.text;
    this.kind     = kindIn ?? ts.SyntaxKind[node.kind];
    this.document = document;
    this.startPos = document.positionAt(node.getStart());
    this.endPos   = document.positionAt(node.getEnd());
    this.markId  = null;
  }
}

export function getFuncs(document: vscode.TextDocument) : Func[] {
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

/*
kinds supported ...
  FunctionDeclaration
  ClassDeclaration
  MethodDeclaration
  FunctionExpression
  ArrowFunction
*/