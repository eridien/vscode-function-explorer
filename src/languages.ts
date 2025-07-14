
export const langs: any = {

  typescript: {
    sExpr: `
      [
        ((function_declaration
            name: (identifier) @funcDeclName) @funcDecl)
        ((variable_declarator
            name: (identifier) @funcExprDeclName
            value: (function_expression) @funcExprDecl) @funcExprDeclBody)
        ((variable_declarator
            name: (identifier) @arrowFuncDeclName
            value: (arrow_function) @arrowFuncDecl) @arrowFuncDeclBody)
        ((class_declaration
            name: (type_identifier) @classDeclName) @classDecl)
        ((method_definition
            name: (property_identifier) @methodDefName) @methodDef)
        ((pair
            key: (property_identifier) @propertyName) @property) @propertyBody
        ((assignment_expression
            left: [(identifier) (member_expression) (subscript_expression)]
                                                      @assExprName) @assExpr)
        ((variable_declarator
            name: (identifier) @varDeclName) @varDecl)
         ((namespace_import
            (identifier) @importName) @import)
     ]
    `,
    capTypes: new Map<string, string>([
      ['funcDecl',          'function_declaration'],
      ['funcExprDeclBody',  'function_expression'],
      ['arrowFuncDeclBody', 'arrow_function'],
      ['classDecl',         'class_declaration'],
      ['methodDef',         'method_definition'],
      ['propertyBody',      'pair'],
      ['assExpr',           'assignment_expression'],
      ['varDecl',           'variable_declarator'],
      ['import',            'namespace_import'],
    ]),
    symbols: new Map<string, string>([
      ['function_declaration',  'ƒ'],
      ['function_expression',   'ƒ'],
      ['arrow_function',        'ƒ'],
      ['method_definition',     'f'],
      ['class_declaration',     '©'],
      ['pair',                  ':'],
      ['assExpr',               ':'],
      ['assignment_expression', '='],
      ['variable_declarator',   '='],
      ['namespace_import',      '▷'],
    ]),
    funcTypes: new Set(["function_declaration", "function_expression", 
                        "method_definition", "arrow_function"]),

    lowPriority: new Set(['variable_declarator']),

    suffixes:    new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

  python: {
    sExpr: `
      [
        ((function_definition
          name: (identifier) @funcDefName) @funcDef)
        ((class_definition
          name: (identifier) @classDefName) @classDef)
        ((assignment
          (pattern) @namedExprName) @namedExpr)
        ((import_from_statement
          module_name: (dotted_name) @importFromName) @importFrom)
      ]
    `,
    capTypes: new Map<string, string>([
      ['funcDef',   'function_definition'],
      ['classDef',  'class_definition'],
      ['namedExpr', 'assignment'],
      ['namedExpr', 'assignment'],
      ['importFrom','import_from_statement'],
    ]),
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['class_definition',      '©'],
      ['assignment',            '='],
      ['import_from_statement', '▷'],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.py'])
  },

  // c: {
  //   sExpr: `
  //     [
  //       ((function_definition
  //         body: (compound_statement) @funcDefName) @funcDef)
  //     ]
  //   `,
  //   capTypes: new Map<string, string>([
  //     ['funcDef',   'function_definition'],
  //   ]),
  //   symbols: new Map([
  //     ['function_definition',   'ƒ'],
  //   ]),
  //   funcTypes:   new Set(["function_definition"]),
  //   lowPriority: new Set(),
  //   suffixes:    new Set(['.c'])
  // },

};
