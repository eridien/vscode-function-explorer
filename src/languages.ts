
type LangConfig = {
  sExpr:       string;
  capTypes:    Map<string, string>;
  symbols:     Map<string, string>;
  funcTypes:   Set<string>;
  lowPriority: Set<string>;
  suffixes:    Set<string>;
};

export type Langs = {
  [lang: string]: LangConfig;
};

export const langs: Langs = {

///////////////////////////// typescript ///////////////////////////
  typescript: {
    sExpr: `
      [
        (function_declaration
            name: (identifier) @funcDeclName) @funcDecl
        (variable_declarator
            name: (identifier) @funcExprDeclName
            value: (function_expression) @funcExprDecl) @funcExprDeclBody
        (variable_declarator
            name: (identifier) @arrowFuncDeclName
            value: (arrow_function) @arrowFuncDecl) @arrowFuncDeclBody
        (class_declaration
            name: (type_identifier) @classDeclName) @classDecl
        (method_definition
            name: (property_identifier) @methodDefName) @methodDef
        (pair
            key: (property_identifier) @propertyName) @property
        (assignment_expression
            left: (identifier) @assExprName) @assExpr
        (variable_declarator
            name: (identifier) @varDeclName) @varDecl
         (namespace_import
            (identifier) @importName) @import
     ]
    `,
    capTypes: new Map<string, string>([
      ['funcDecl',          'function_declaration'],
      ['funcExprDeclBody',  'function_expression'],
      ['arrowFuncDeclBody', 'arrow_function'],
      ['classDecl',         'class_declaration'],
      ['methodDef',         'method_definition'],
      ['property',          'pair'],
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
                        "method_definition",    "arrow_function"]),
    lowPriority: new Set(['variable_declarator']),
    suffixes: new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `
      [
        (function_definition
          name: (identifier) @funcDefName) @funcDef
        (class_definition
          name: (identifier) @classDefName) @classDef
        (assignment
          (pattern) @namedExprName) @namedExpr
        (import_statement
          (dotted_name) @importName) @import
        (import_from_statement
          (dotted_name) @importFromName) @importFrom
      ]
    `,
    capTypes: new Map<string, string>([
      ['funcDef',    'function_definition'],
      ['classDef',   'class_definition'],
      ['namedExpr',  'assignment'],
      ['namedExpr',  'assignment'],
      ['import',     'import_statement'],      // import foo
      ['importFrom', 'import_from_statement'], // from foo import bar
    ]),
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['class_definition',      '©'],
      ['assignment',            '='],
      ['import_statement',      '▷'],
      ['import_from_statement', '▷'],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.py'])
  },

///////////////////////////// c ///////////////////////////
  c: {
    sExpr: `
      [
        (function_definition
          declarator: (function_declarator
            declarator: (identifier) @funcDefName)) @funcDef
        (assignment_expression
          left: (identifier) @assExprName) @assExpr
        (call_expression
          function: (identifier) @callExprName) @callExpr
      ]
    `,
    capTypes: new Map<string, string>([
      ['funcDef',  'function_definition'],
      ['assExpr',  'assignment_expression'],
      ['callExpr', 'call_expression'],
    ]),
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['assignment_expression', '='],
      ['call_expression',       '('],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.c','.cpp'])
  },

///////////////////////////// java ///////////////////////////
  java: {
    sExpr: `
      [
        (method_declaration
           (identifier) @methodDeclName) @methodDecl
        (class_declaration
           name: (identifier) @classDeclName) @classDecl
        (assignment_expression
           left: (identifier) @assExprName) @assExpr
      ]
    `,
    capTypes: new Map<string, string>([
      ['methodDecl',  'method_declaration'],
      ['classDecl',   'class_declaration'],
      ['assExpr',     'assignment_expression'],
    ]),
    symbols: new Map([
      ['method_declaration',    'ƒ'],
      ['class_declaration',     '©'],
      ['assignment_expression', '='],
    ]),
    funcTypes:   new Set(["method_declaration"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.java'])
  },

};
