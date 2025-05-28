import * as vscode from 'vscode';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

function getSymbols(pos: vscode.Position, 
                    symbols: vscode.DocumentSymbol[]) {
  const parent = symbols[symbols.length - 1];
  for(const child of parent.children) {
    const lftPos = new vscode.Position(pos.line, 0);
    const rgtPos = new vscode.Position(pos.line+1, 0);
    if(child.range.start.line > pos.line) return symbols;
    if(child.range.contains(lftPos) || 
       child.range.contains(pos)    || 
       child.range.contains(rgtPos)) {
      symbols.push(child);
      return getSymbols(pos, symbols);
    }
  }
}

export async function findSymbol(
                        document: vscode.TextDocument, 
                        position: vscode.Position): Promise<string | undefined> {
  const topSymbols : vscode.DocumentSymbol[] = 
                     await vscode.commands.executeCommand(
                    'vscode.executeDocumentSymbolProvider', document.uri);
  if (!topSymbols || topSymbols.length == 0) {
    log('getLabel, No topSymbols found.', document.uri.path);
    return;
  }
  // @ts-expect-error
  const symbols: vscode.DocumentSymbol[] = [{children: topSymbols}];
  getSymbols(position, symbols);
  if (!symbols.length) { return; }
  // log(symbols);
}

