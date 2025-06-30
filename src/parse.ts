import Parser                from 'tree-sitter';
import type { SyntaxNode }   from 'tree-sitter';
import JavaScript            from 'tree-sitter-javascript';
const {typescript, tsx} = require('tree-sitter-typescript');
import * as utils            from './utils';
const {log, start, end} = utils.getLog('pars');

// const langObj = JavaScript;
// const langObj = typescript;
const langObj = tsx;

const sExpr = `
  [
    ((function_declaration
      name: (identifier) @funcDecName)   @funcDec)
    ((function_expression
      name: (identifier) @funcExprName)  @funcExpr)
    ((variable_declarator
      name: (identifier)      @funcArrowName
      value: (arrow_function) @funcArrow) @funcArrowBody)
  ]
`;
const funcDecs =  ['funcDec', 'funcExpr', 'funcArrow'];

export interface NodeData {
  funcId:       string;
  funcParents:  [string, string][];
  name:         string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
}

export function parseCode(code: string, fsPath: string): NodeData[] {

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

  function capsToNodeData(nameCapture: Parser.QueryCapture, 
                          funcCapture: Parser.QueryCapture,
                          bodyCapture: Parser.QueryCapture | undefined)
                                      :NodeData | null {
    const startName = nameCapture.node.startIndex;
    const endName   = nameCapture.node.endIndex;
    const name      = code.slice(startName, endName);
    if (!name) return null;
    let funcNode = funcCapture.node;
    let parents  = getAllParents(funcNode);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(funcNode);
    if(bodyCapture) {
      funcNode = bodyCapture.node;
      parents = parents.slice(1);
    }
    for(let parent of parents) {
      funcId += idNodeName(parent);
      const nameNode = parent.childForFieldName('name');
      const name     = nameNode?.text;
      if (name) funcParents.push([name, parent.type]);
    }
    funcId += fsPath;
    return { name, funcParents, funcId, startName, endName,
             type:  funcNode.type,
             start: funcNode.startIndex,
             end:   funcNode.endIndex };
  }

  start('parseCode');
  const parser = new Parser();
  parser.setLanguage(langObj as any);
  const tree = parser.parse(code);
  const nodes: NodeData[] = [];
  try {
    const Query = Parser!.Query!;
    const query = new Query(langObj as any, sExpr);
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      const funcCapture = match.captures.find(
                             capture => funcDecs.includes(capture.name));
      if(!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(c => c.name.endsWith('Name'));
      if(!nameCapture || !nameCapture.node.isNamed) continue;
      const bodyCapture = match.captures.find(c => c.name.endsWith('Body'));
      const nodeData = capsToNodeData(nameCapture, funcCapture, bodyCapture);
      if(!nodeData) continue;
      nodes.push(nodeData);
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  log(`Parsed ${nodes.length} nodes`);
  end('parseCode', false);
  return nodes;
}
