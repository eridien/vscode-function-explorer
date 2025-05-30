import vscode      from 'vscode';
import {Mark}      from './marks.js';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mark');

export class Banner {
  text:  string;
  mark?: Mark;
  constructor(p: any) {
    this.text = text;
  }
}

export function getAllBanners(document: vscode.TextDocument): Banner[] {
  const docText = document.getText();
  if (!docText) return [];
  const matches = [...docText.matchAll(utils.invChrRegEx)];
  const banners: Banner[] = [];
  let lastIdx = 0;
  for (const match of matches) {
    if(match.index < lastIdx) continue;
    let bannerId = 0;
    const bannerLineNum = document.positionAt(match.index).line;
    let lineNum = bannerLineNum;
    let corrupt = false;
    for(; lineNum < document.lineCount; lineNum++) {
      const bannerLine = document.lineAt(lineNum);
      const lineText   = bannerLine.text;
      const lineEmpty  = bannerLine.isEmptyOrWhitespace;
      const groups     = utils.bannerRegx.exec(lineText);
      if (!groups && !lineEmpty) {
        if(utils.invChrRegEx.test(lineText)) {
          log('infoerr', `Function Marks: Corrupt banner, line ${lineNum}. ` +
                         `Please delete the banner.`);
          corrupt = true;
        }
        break;
      }
      if(!corrupt && groups) {
        const [, idStr, lineTypeChr] = [...groups];
        bannerId = utils.invBase4ToNumber(idStr);
        const lineType = ['topBorder', 'textLine', 'bottomBorder', null]
                         [utils.inv2num(lineTypeChr)];
      }
    }
    banners.push(new Banner({
      startLine: bannerLineNum,
      endLine:   lineNum -1,
      id:        bannerId,
    }));
    lastIdx = document.offsetAt(new vscode.Position(lineNum, 0));
  }
  if (matches.length === 0) return [];
  return Array.from(matches, (match) => );
}
