import * as vscode from 'vscode';
import * as parse  from './parse';
import * as utils  from './utils';
const {log} = utils.getLog('line');

interface Line {
  inline:     boolean;
  id:         number;
  text:       string;
}

export function getLines(document: vscode.TextDocument): Line[] {
  const lines: Line[] = [];
  return lines;
}