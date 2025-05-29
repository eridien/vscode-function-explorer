import vscode      from 'vscode';
import {Mark}      from './marks.js';
import * as utils  from './utils.js';
const {log, start, end} = utils.getLog('mark');

export class Banner {
  text:  string;
  mark?: Mark;
  constructor(inline: boolean, text: string) {
    this.text   = text;
  }
}
