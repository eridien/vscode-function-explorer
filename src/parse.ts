import * as vscode from 'vscode';
import * as ts from "typescript";
import * as utils  from './utils';
const {log} = utils.getLog('pars');

class FuncNode {
  name:  string;
  kind:  string;
  start: vscode.Position;
  end:   vscode.Position;
  constructor(node: ts.Node, document: vscode.TextDocument) {
    this.start = document.positionAt(node.getStart());
    this.end   = document.positionAt(node.getEnd());
    this.kind  = ts.SyntaxKind[node.kind];
     if (
        !(ts.isFunctionDeclaration(node)   ||
          ts.isClassDeclaration(node)      ||
          ts.isVariableDeclaration(node)   ||
          ts.isMethodDeclaration(node)     ||
          !node.name || !ts.isIdentifier(node.name)
    ) throw new Error(`Node has no name, kind: ${this.kind}, ` + 
                      `start: ${this.start}, end: ${this.end}`);
    this.name  = node.name.text;
  }
}

export function getFuncNodes(
                       document: vscode.TextDocument) : FuncNode[]{
  const sourceFile = ts.createSourceFile(
              document.fileName, document.getText(), 
              ts.ScriptTarget.Latest, true);
  const funcNodes:  FuncNode[] = [];
  function traverse(node: ts.Node) {
    if((ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)    ||
        ts.isMethodDeclaration(node)) && node.name)
          funcNodes.push(new FuncNode(node, document));
    else if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isFunctionExpression(node.initializer) || 
            ts.isArrowFunction(node.initializer))
      funcNodes.push(new FuncNode(node, document));
    }
    ts.forEachChild(node, traverse);
  }
  traverse(sourceFile);
  return funcNodes;
}
