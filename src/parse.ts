import Parser              from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import JavaScript          from 'tree-sitter-javascript';
import * as utils          from './utils';
const {log, start, end} = utils.getLog('pars');

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

  function nodeToNodeData(nameCapture: Parser.QueryCapture, 
                          funcCapture: Parser.QueryCapture): NodeData | null {
    const startName = nameCapture.node.startIndex;
    const endName   = nameCapture.node.endIndex;
    const name      = code.slice(startName, endName);
    if (!name) return null;
    const funcNode = funcCapture.node;
    let   parents  = getAllParents(funcNode);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(funcNode);
    if(funcCapture.name === 'arrowFunc') 
      parents = parents.slice(1);
    for(let parent of parents) {
      funcId  += idNodeName(parent);
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

  function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkTree(child, visit);
    }
  }
  start('parseCode');
  const parser = new Parser();
  parser.setLanguage(JavaScript as any);
  const tree = parser.parse(code);
  const nodes: NodeData[] = [];
  try {
    const Query = Parser!.Query!;
    const query = new Query(JavaScript as any, `
        [
          ((function_declaration
            name: (identifier) @funcDecName)   @funcDec)
          ((function_expression
            name: (identifier) @funcExprName)  @funcExpr)
          ((variable_declarator
            name: (identifier)      @arrowFuncName
            value: (arrow_function) @arrowFunc) @arrowFuncBody)
        ]
    `);
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      const funcCapture  = match.captures.find(c => 
        ['funcDec', 'funcExpr', 'arrowFunc']
         .includes(c.name));
      if(!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(c => c.name.endsWith('Name'));
      if(!nameCapture || !nameCapture.node.isNamed) continue;
      const nodeData = nodeToNodeData(nameCapture, funcCapture);
      if(!nodeData) continue;
      nodes.push(nodeData);
      switch(funcCapture?.name) {
        case 'funcDec':
          log(`function declaration: ${nameCapture?.node.text} at ` +
          `${nameCapture?.node.startPosition.row}:${nameCapture?.node.endPosition.row}`);
          break;
        case 'funcExpr':
          log(`function expression: ${nameCapture?.node.text} at ` +
                      `${nameCapture?.node.startPosition.row}:${nameCapture?.node.endPosition.row}`);
          break;
        case 'arrowFunc':
          log(`arrow function: ${nameCapture?.node.text} at ` +
                      `${nameCapture?.node.startPosition.row}:${nameCapture?.node.endPosition.row}`);
          break;
        case 'varDec':
          log(`variable declaration: ${nameCapture?.node.text} at ` +
                      `${nameCapture?.node.startPosition.row}:${nameCapture?.node.endPosition.row}`);
          break;
        default:
          log(`unknown type: ${funcCapture?.name} at ` +
                      `${nameCapture?.node.startPosition.row}:${nameCapture?.node.endPosition.row}`);
      }
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
  }
  log(`Parsed ${nodes.length} nodes`);
  end('parseCode', false);
  return nodes;
}
