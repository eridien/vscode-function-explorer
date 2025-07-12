import * as vscode           from 'vscode';
import path                  from 'path';
import Parser                from 'tree-sitter';
import type { SyntaxNode }   from 'tree-sitter';
import {langs}               from './languages';
import JavaScript            from 'tree-sitter-javascript';
const Parser = require('web-tree-sitter');
import * as utils           from './utils';
const {log, start, end} = utils.getLog('pars');

const PARSE_DEBUG_TYPE: string = '';
const PARSE_DEBUG_NAME: string = '';
// const PARSE_DEBUG_TYPE: string = 'function_definition';
// const PARSE_DEBUG_NAME: string = 'Item';

export interface NodeData {
  funcId:       string;
  funcParents:  [string, string][];
  name:         string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
  lang:         string;
}

function parseDebug(rootNode: SyntaxNode) {
    function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkTree(child, visit);
    }
  }
  walkTree(rootNode, node => {
    let name = 'anonymous';
    const nameNode = node.childForFieldName('name');
    if(nameNode) name = nameNode.text;
    const nodeData = {
      name,
      type: node.type,
      start: node.startIndex,
      end: node.endIndex
    };
    if(node.type === PARSE_DEBUG_TYPE) debugger;
    if(nodeData && PARSE_DEBUG_NAME === name) debugger;
  });
}

export function getFuncTypes(lang: string): Set<string> {
  return langs[lang].funcTypes;
}

export function getSymbol(lang: string, type: string): string {
  return langs[lang].symbols.get(type);
}

export function getLangByFsPath(fsPath: string): string | null {
  const ext = path.extname(fsPath);
  for (const [lang, {suffixes}] of Object.entries(langs) as any) {
    if(suffixes.has(ext)) return lang;
  }
  log('infoerr', `Function Explorer: Language for ${ext} not supported.`);
  return null;
}

let lastParseErrFsPath = '';

export function parseCode(lang: string, code: string, fsPath: string,
                          retrying = false): NodeData[] | null {
  const {sExpr, capTypes, symbols, lowPriority} = langs[lang];
  const langObj  = langObjs.get(lang);
  if (!langObj) {
    log('infoerr', `Function Explorer: Language ${lang} not supported.`);
    return null;
  }
  function getAllParents(node: SyntaxNode): SyntaxNode[] {
    const parents: SyntaxNode[] = [];
    let parent = node.parent;
    while (parent) {
      parents.push(parent);
      parent = parent.parent;
    }
    return parents;
  }

  function idNodeName(node: SyntaxNode): string {
    const  nameNode = node.childForFieldName('name');
    if(!nameNode) return '';
    return nameNode.text + "\x00" + node.type + "\x00";
  }

  function capsToNodeData(lang: string,
                          nameCapture: Parser.QueryCapture,
                          funcCapture: Parser.QueryCapture,
                          bodyCapture: Parser.QueryCapture | undefined)
                                      :NodeData | null {
    const nameNode  = nameCapture.node;
    const startName = nameNode.startIndex;
    const endName   = nameNode.endIndex;
    const name      = code.slice(startName, endName);
    if (!name) return null;
    let funcNode = funcCapture.node;
    let start    = funcNode.startIndex;
    let end      = funcNode.endIndex;
    let type     = funcNode.type;
    let parents  = getAllParents(funcNode);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(funcNode);
    if( funcId === '') funcId = name + "\x00" + type + "\x00";
    if(bodyCapture) {
      start = bodyCapture.node.startIndex;
      end   = bodyCapture.node.endIndex;
      parents = parents.slice(1);
    }
    for(let parent of parents) {
      funcId += idNodeName(parent);
      const nameNode = parent.childForFieldName('name');
      const name     = nameNode?.text;
      if (name) funcParents.push([name, parent.type]);
    }
    funcId += fsPath;
    return { lang, name, funcParents, funcId, 
             start, startName, endName, end, type };
  }
  start('parseCode', true);
  const parser = new Parser();
  parser.setLanguage(langObj as any);
  let tree: Parser.Tree;
  try {
    tree = parser.parse(code);
  } catch (e) {
    if(retrying) {
      log('err', 'parser.parse failed again, giving up:', (e as any).message);
      return null;
    }
    const middle    = utils.findMiddleOfText(code);
    if(lastParseErrFsPath !== fsPath)
      log('err', 'parse exception, retrying in two halves split at', middle,
                                 (e as any).message, path.basename(fsPath));
    lastParseErrFsPath = fsPath;
    const firstHalf = code.slice(0, middle);
    const res1      = parseCode(lang, firstHalf, fsPath, true);
    if(!res1) return null;
    const secondHalf = code.slice(middle);
    const res2       = parseCode(lang, secondHalf, fsPath, true);
    if (!res2) return null;
    for (const node of res2) {
      node.start += middle;
      node.end   += middle;
    }
    return res1.concat(res2);
  }
  if(PARSE_DEBUG_NAME !== '' || 
     PARSE_DEBUG_TYPE !== '')   
    parseDebug(tree.rootNode);
  const nodes: NodeData[] = [];
  try {
    const Query   = Parser!.Query!;
    const query   = new Query(langObj as any, sExpr);
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      const funcCapture = match.captures.find(
                             capture =>   capTypes.has(capture.name));
      if(!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(c => c.name.endsWith('Name'));
      if(!nameCapture || !nameCapture.node.isNamed) continue;
      const bodyCapture = match.captures.find(c => c.name.endsWith('Body'));
      const nodeData = 
            capsToNodeData(lang, nameCapture, funcCapture, bodyCapture);
      if(!nodeData) continue;
      nodes.push(nodeData);
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  nodes.sort((a, b) => a.start - b.start);
  const result: NodeData[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    let j = i + 1;
    while(
      j < nodes.length &&
      nodes[j].start === node.start &&
      nodes[j].end   === node.end
    ) j++;
    let ok = node;
    if (j > i + 1) {
      for (let k = i + 1; k < j; k++) {
        if(!lowPriority.has(nodes[k].type)) {
          ok = nodes[k];
          break;
        }
      }
    } 
    result.push(ok);
    i = j;
  }
  // log(`Parsed ${nodes.length} nodes`);
  end('parseCode', true);
  return result;
}
/*

const Parser = require('web-tree-sitter');

(async () => {
import Parser from 'web-tree-sitter';

await Parser.init();
const parser = new Parser();
const Lang = await Parser.Language.load(context.asAbsolutePath('media/tree-sitter-javascript.wasm'));
parser.setLanguage(Lang);
})();

const tree = parser.parse(document.getText());
const root = tree.rootNode;

*/