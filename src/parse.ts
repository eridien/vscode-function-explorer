import * as vscode                         from 'vscode';
import path                                from 'path';
import {langs}                             from './languages';
import { Tree, SyntaxNode, QueryCapture }  from 'tree-sitter';
import { Parser, Language, Query }         from 'web-tree-sitter';
import * as utils                          from './utils';
const {log, start, end} = utils.getLog('pars');

const PARSE_DEBUG_TYPE: string = '';
const PARSE_DEBUG_NAME: string = 'os';

let context: vscode.ExtensionContext;

export async function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  await Parser.init();

}

const languageCache: Map<string, Language> = new Map();

async function getLangFromWasm(lang:string) {
  if(languageCache.has(lang)) return languageCache.get(lang);
  const absPath = context?.asAbsolutePath(`wasm/tree-sitter-${lang}.wasm`);
  if(!absPath) {
    log('infoerr', `Function Explorer: Language ${lang} not supported.`);
    return null;
  }
  const wasmUri  = vscode.Uri.file(absPath);
  const language = await Language.load(wasmUri.fsPath);
  languageCache.set(lang, language);
  return language;
}

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
  let dumping   = false;
  let depth     = -1;
  let lineCount = 0;
  let done      = false;
  function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && !done) {
        depth++;
        walkTree(child, visit);
        depth--;
      }
    }
  }
  walkTree(rootNode, node => {
    let name = 'anonymous';
    const nameNode = node.childForFieldName('name');
    if(nameNode) name = nameNode.text;
    else if(node.type === 'identifier') name = node.text;
    dumping ||= (node.type === PARSE_DEBUG_TYPE || PARSE_DEBUG_NAME === name);
    if(dumping && !done) {
      console.log(` ${'    '.repeat(depth)}${node.type} `+
                  `(${node.startIndex},${node.endIndex}) ${name}`);
      if(lineCount++ > 100) done = true;
    }
  });
}

export function getFuncTypes(lang: string): Set<string> {
  return langs[lang].funcTypes;
}

export function getSymbol(lang: string, type: string): string {
  const symbol = langs[lang]?.symbols?.get(type);
  if(symbol === undefined) {
    if(type !== '') log(`No symbol for type '${type}' in lang '${lang}'`);
    return '?';
  }
  return symbol;
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

export async function parseCode(lang: string, code: string, fsPath: string,
                          retrying = false): Promise<NodeData[] | null> {
  const language = await getLangFromWasm(lang);
  if (!language) return [];

  const { sExpr, capTypes, symbols, lowPriority }: {
    sExpr: string;
    capTypes: Map<string, string>;
    symbols: Map<string, string>;
    lowPriority: Set<string>;
  } = langs[lang];

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
                          nameCapture: QueryCapture,
                          funcCapture: QueryCapture,
                          bodyCapture: QueryCapture | undefined)
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
  parser.setLanguage(language);
  let tree: Tree | null;
  try {
    tree = parser.parse(code) as Tree | null;
    if(!tree) {
      log('err', 'parser.parse returned null tree for', path.basename(fsPath));
      return [];
    }
  } 
  catch (e) {
    if(retrying) {
      log('err', 'parser.parse failed again, giving up:', (e as any).message);
      return [];
    }
    const middle    = utils.findMiddleOfText(code);
    if(lastParseErrFsPath !== fsPath)
      log('err', 'parse exception, retrying in two halves split at', middle,
                                 (e as any).message, path.basename(fsPath));
    lastParseErrFsPath = fsPath;
    const firstHalf = code.slice(0, middle);
    const res1      = await parseCode(lang, firstHalf, fsPath, true);
    if(!res1) return [];
    const secondHalf = code.slice(middle);
    const res2       = await parseCode(lang, secondHalf, fsPath, true);
    if (!res2) return [];
    for (const node of res2) {
      node.start += middle;
      node.end   += middle;
    }
    return res1.concat(res2);
  }
  if(PARSE_DEBUG_NAME !== '' || PARSE_DEBUG_TYPE !== '')   
    parseDebug(tree.rootNode);
  const nodes: NodeData[] = [];
  try {
    const query   = new Query(language as any, sExpr);
    const matches = query.matches(tree.rootNode as any);
    for (const match of matches) {
      const funcCapture = match.captures.find(
                             capture => capTypes.has(capture.name));
      if (!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(c => c.name.endsWith('Name'));
      if (!nameCapture || !nameCapture.node.isNamed) continue;
      const bodyCapture = match.captures.find(c => c.name.endsWith('Body'));
      const nodeData = capsToNodeData(
        lang,
        nameCapture as any,
        funcCapture as any,
        bodyCapture as any
      );
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
