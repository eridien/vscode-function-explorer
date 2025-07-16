
type LangConfig = {
  sExpr:       string;
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
            name: (identifier) @name
        ) @function_declaration

        (variable_declarator
            name: (identifier) @name
            value: (function_expression)
        ) @function_expression

        (variable_declarator
            name: (identifier) @name
            value: (arrow_function)
        ) @arrow_function

        (class_declaration
            name: (type_identifier) @name
         ) @class_declaration

        (method_definition
            name: (property_identifier) @name
         ) @method_definition
         
        (pair
            key: (property_identifier) @name
         ) @property

        (assignment_expression
            left: (identifier) @name
         ) @assignment_expression

        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
            value: (_) @value
            (#not-match? @value "=>"))
         ) @assignment

         (namespace_import
            (identifier) @name
         ) @import
     ]
    `,
    symbols: new Map<string, string>([
      ['function_declaration',  'ƒ'],
      ['function_expression',   'ƒ'],
      ['arrow_function',        'ƒ'],
      ['method_definition',     'f'],
      ['class_declaration',     '©'],
      ['property',              ':'],
      ['assignment',            '='],
      ['assignment_expression', '='],
      ['import',                '▷'],
    ]),
    funcTypes: new Set(["function_declaration", "function_expression", 
                        "method_definition",    "arrow_function"]),
    lowPriority: new Set(),
    suffixes: new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `
      [
        (function_definition
          name: (identifier) @name
         ) @function_definition

        (class_definition
          name: (identifier) @name
         ) @class_definition

        (assignment
          (pattern) @name
        ) @assignment

        ;; assignment_expression ??
        
        (import_statement
          (dotted_name) @name
        ) @import

        (import_from_statement
          (dotted_name) @name
        ) @importFrom
      ]
    `,
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['class_definition',      '©'],
      ['assignment',            '='],
      ['import',                '▷'],
      ['importFrom',            '▷'],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.py'])
  },

///////////////////////////// cpp ///////////////////////////
  cpp: {
    sExpr: `
      [
        (function_definition
          declarator: (function_declarator
            declarator: (identifier) @name)
         ) @function_definition

        (assignment_expression
          left: (identifier) @name
         ) @assignment_expression

        (call_expression
          function: (identifier) @name
         ) @call_expression
      ]
    `,
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
           (identifier) @name
         ) @method_declaration

        (class_declaration
           name: (identifier) @name
         ) @class_declaration

        (assignment_expression
           left: (identifier) @name
         ) @assignment_expression
      ]
    `,
    symbols: new Map([
      ['method_declaration',    'ƒ'],
      ['class_declaration',     '©'],
      ['assignment_expression', '='],
    ]),
    funcTypes:   new Set(["method_declaration"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.java'])
  },

///////////////////////////// c-sharp ///////////////////////////
  "c-sharp": {
    sExpr: `
      [
        (method_declaration
           name: (identifier) @name
         ) @method_declaration

        (local_function_statement
           name: (identifier) @name
         ) @local_function_statement

        (local_declaration_statement              ;; int x = 5;
          (variable_declaration
            (variable_declarator
              name: (identifier) @name))
         ) @local_declaration_statement

        (expression_statement                      ;;  x = 5;
          (assignment_expression
            left: (identifier) @name)
         ) @expression_statement

        (class_declaration
          name: (identifier) @name
         ) @class_declaration
      ]
    `,
    symbols: new Map([
      ['method_declaration',          'ƒ'],
      ['local_function_statement',    'ƒ'],
      ['local_declaration_statement', '='],
      ['expression_statement',        '='],
      ['class_declaration',           '©'],
    ]),
    funcTypes:   new Set(["method_declaration", "local_function_statement"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.cs'])
  },

};
