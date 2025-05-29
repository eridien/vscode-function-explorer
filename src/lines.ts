import * as vscode from 'vscode';
import * as parse  from './parse';
import * as utils  from './utils';
const {log} = utils.getLog('line');

type lineType = mark: string | 
                description: string;
interface Line {
  type:       lineType;
  lineNumber: number;
  inline:     boolean;
  id:         number;
  text:       string;
}

export function getLines(document: vscode.TextDocument): Line[] {
  utils.initIdNumber(document);
  const docText = document.getText();
  const matches = [...docText.matchAll(utils.invChrRegEx)];
  const lines: Line[] = [];
  matches.forEach(match => {
    const lineNumber = document.positionAt(match.index).line;
    const lineText   = document.lineAt(lineNumber).text;
    const groups = utils.lineRegEx.exec(lineText);
    if(!groups) {
      log('infoerr', `Corrupted function mark at line ${lineNumber+1}. ` +
                     `Please delete the line or fix it.`);
      return;
    }
    //  `^((\s*)(//)(${oneInvChar}{6})(.*?)\s*$)|` + 
    //  `^((\s*)(/\*)(${oneInvChar}{6})(.*?)\*/.*$)`);
    let inline: boolean;
    let id:     number;
    let text:   string;
   if(groups[3] !== '//') {
     inline = false;
     id     = utils.invBase4ToNumber(groups[4]);
     text   = groups[5];
   }
   else {
     inline = true;
     id     = utils.invBase4ToNumber(groups[9]);
     text   = groups[10];
   }
   lines.push(
     { type: 'mark', inline, id, text}
   );
  });
  return lines;
}