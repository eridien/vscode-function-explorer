import * as vscode                         from 'vscode';
import path                                from 'path';
import {langs}                             from './languages';
import { Tree, SyntaxNode, QueryCapture }  from 'tree-sitter';
import { Parser, Language, Query }         from 'web-tree-sitter';
import * as utils                          from './utils';
const {log, start, end} = utils.getLog('pars');

const PARSE_DUMP_TYPE: string = '';  
const PARSE_DUMP_NAME: string = '';
const PARSE_DEBUG_STATS = true;

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
  let dumping    = false;
  let depth      = 0;
  let firstDepth = 0;
  let lineCount  = 0;
  let done       = false;
  function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && !done) {
        depth++;
        walkTree(child, visit);
        if(--depth < firstDepth) done = true;
      }
    }
  }
  walkTree(rootNode, node => {
    let name = ' ';
    const nameNode = node.childForFieldName('name');
    if(nameNode) name = nameNode.text;
    else if(node.type === 'identifier') name = node.text;
    if(!dumping && (node.type === PARSE_DUMP_TYPE || 
                         name === PARSE_DUMP_NAME)) {
      firstDepth = depth;
      dumping    = true;
    }
    if(dumping && !done) {
      log('nomod', `${'    '.repeat(depth-firstDepth)}${node.type} `+
                   `(${node.startIndex},${node.endIndex}) ${name}`);
      if(lineCount++ > 100) done = true;
    }
  });
}

export function getFuncTypes(lang: string): Set<string> {
  return langs[lang].funcTypes;
}

export function getSymbol(lang: string, type: string): string {
  const  symbol = langs[lang]?.symbols?.get(type);
  return symbol ?? '?';
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
                          doc: vscode.TextDocument, retrying = false): 
                                               Promise<NodeData[] | null> {
  const language = await getLangFromWasm(lang);
  if (!language) return [];

  const { sExpr, symbols }: {
    sExpr: string;
    symbols: Map<string, string>;
  } = langs[lang];

  function getParents(node: SyntaxNode): SyntaxNode[] {
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

  let typeCounts: Map<string, number> = new Map();
  let maxGap     = 0;
  let lastIdx    = 0;
  let startIndex = 0;
  let endIndex   = code.length;

  function collectParseStats(nodeData: NodeData | null = null) {
    if(!nodeData) {
      const gap = code.length - lastIdx;
      if(gap > maxGap) {
        startIndex = lastIdx;
        endIndex   = code.length;
      }
      return;
    }
    typeCounts.set(nodeData.type, 
                  (typeCounts.get(nodeData.type) ?? 0) + 1);
    const gap = nodeData.startName - lastIdx;
    if(gap > maxGap) {
      maxGap = gap;
      startIndex = lastIdx;
      endIndex   = nodeData.startName;
    }
    lastIdx = nodeData.endName;
  }

  function capsToNodeData(lang: string,
                          nameCapture: QueryCapture,
                          funcCapture: QueryCapture) :NodeData | null {
    const nameNode  = nameCapture.node;
    const startName = nameNode.startIndex;
    const endName   = nameNode.endIndex;
    const name      = code.slice(startName, endName);
    if (!name) return null;
    let type     = funcCapture.name;
    let funcNode = funcCapture.node;
    let start    = funcNode.startIndex;
    let end      = funcNode.endIndex;
    let parents  = getParents(funcNode);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(funcNode);
    if( funcId === '') funcId = name + "\x00" + type + "\x00";
    for(let parent of parents) {
      funcId += idNodeName(parent);
      const nameNode = parent.childForFieldName('name');
      const name     = nameNode?.text;
      if (name) funcParents.push([name, parent.type]);
    }
    funcId += fsPath;
    const nodeData: NodeData = { lang, name, funcParents, funcId, 
                                 start, startName, endName, end, type };
    if(PARSE_DEBUG_STATS) collectParseStats(nodeData);
    return nodeData;
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
    const res1      = await parseCode(lang, firstHalf, fsPath, doc, true);
    if(!res1) return [];
    const secondHalf = code.slice(middle);
    const res2       = await parseCode(lang, secondHalf, fsPath, doc, true);
    if (!res2) return [];
    for (const node of res2) {
      node.start += middle;
      node.end   += middle;
    }
    return res1.concat(res2);
  }
  if(PARSE_DUMP_NAME !== '' || PARSE_DUMP_TYPE !== '')   
    parseDebug(tree.rootNode);
  const nodes: NodeData[] = [];
  try {
    const query   = new Query(language as any, sExpr);
    const matches = query.matches(tree.rootNode as any);
    for (const match of matches) {
      const funcCapture = match.captures.find(
                             capture => symbols.has(capture.name));
      if (!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(
                             capture => capture.name == 'name');
      if (!nameCapture || !nameCapture.node.isNamed) continue;
      const nodeData = capsToNodeData(
                         lang, nameCapture as any, funcCapture as any
      );
      if(!nodeData) continue;
      nodes.push(nodeData);
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  nodes.sort((a, b) => a.start - b.start);

  if(PARSE_DEBUG_STATS) {
    collectParseStats();
    const lineCount    = doc.positionAt(code.length).line;
    const gapStartLine = doc.positionAt(startIndex ).line+2;
    const gapEndLine   = doc.positionAt(endIndex   ).line;
    const gapLines     = gapEndLine - gapStartLine;
    const nodeCount    = nodes.length;
    log('nomod', `\n${path.basename(fsPath)}: ` +
        `parsed ${nodeCount} nodes in ${lineCount} lines\n` +
        `max gap start line: ${gapStartLine}, end line: ${gapEndLine}\n` +
        `gap lines avg: ${Math.floor(lineCount/(nodeCount + 1))}, ` +
                  `max: ${gapLines}\n` +
        [...typeCounts.entries()].map(([t,c]) => `${t}: ${c}`).join('\n'));
  }
  end('parseCode', true);
  return nodes;
}
