; Comments and documentation
(comment) @comment
(pod) @comment.documentation

; Literals
(integer) @number
(decimal) @number.float
(rational) @number
(complex) @number
(version) @constant

(string) @string
(interpolated_string) @string
(string_content) @string
(quoted) @string
(quote_words) @string
(word) @string
(heredoc_start) @string
(heredoc_body) @string
(escape_sequence) @string.escape
(quote_operator) @keyword.operator
(adverb) @attribute

(regex) @string.regexp
(regex_body) @string.regexp
(substitution) @string.regexp

(interpolation
  (block
    "{" @punctuation.special
    "}" @punctuation.special))

; Variables
(variable) @variable
(sigilless_variable) @variable
(anonymous_variable) @variable
(colon_variable) @variable.parameter
(self) @variable.builtin

((variable) @variable.builtin
  (#match? @variable.builtin "^[$@%&][*?]"))

((variable) @variable.builtin
  (#match? @variable.builtin "^[$@%](_|/|!|¢|\\d+)$"))

(parameter name: (variable) @variable.parameter)
(parameter name: (sigilless_variable) @variable.parameter)
(pointy_block parameters: (parameter_list (parameter name: (variable) @variable.parameter)))

((variable) @variable.member
  (#match? @variable.member "^[$@%&][.!]"))

; Types and packages
(type (identifier) @type)
(type_smiley) @type.qualifier
(package_declaration name: (identifier) @type.definition)
(unit_declaration name: (identifier) @type.definition)
(enum_declaration name: (identifier) @type.definition)
(subset_declaration name: (identifier) @type.definition)
(trait value: (identifier) @type)
(use_statement module: (identifier) @module)
(name_adverb key: (name) @attribute)

((identifier) @type
  (#match? @type "^[A-Z][A-Za-z0-9_:-]*[a-z][A-Za-z0-9_:-]*$"))

((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_-]+$"))

; Routines
(routine_declaration name: (identifier) @function)
(routine_declaration name: (operator_name) @function)
(regex_declaration name: (identifier) @function)
(call_expression function: (identifier) @function.call)
(listop_call function: (identifier) @function.call)
(method_call method: (identifier) @function.method.call)
(method_listop_call method: (identifier) @function.method.call)
(topic_method_call method: (identifier) @function.method.call)
(mutating_method_call method: (identifier) @function.method.call)
(operator_name) @function

((variable) @function
  (#match? @function "^&"))

((listop_call function: (identifier) @function.builtin)
  (#any-of? @function.builtin
    "say" "put" "print" "note" "printf" "sprintf" "die" "warn" "exit" "map" "grep"
    "sort" "push" "pop" "shift" "unshift" "splice" "join" "split" "elems" "keys" "values"
    "await" "sleep" "slurp" "spurt" "open" "dd" "exit" "callsame" "nextsame" "callwith"
    "nextwith" "samewith" "bless" "EVAL"))

((identifier) @keyword.return
  (#any-of? @keyword.return "return" "return-rw"))

((identifier) @keyword.control
  (#any-of? @keyword.control "next" "last" "redo" "succeed" "proceed" "done" "emit" "take" "fail"))

((identifier) @constant.builtin
  (#any-of? @constant.builtin "True" "False" "Nil" "Any" "Mu" "Empty" "pi" "e" "tau" "i" "π" "τ"))

; Pairs and named arguments
(colonpair key: (name) @property)
(assignment
  left: (identifier) @property
  operator: "=>")
(subscript index: (word) @property)

; Labels
(label) @label

; Keywords
(scope) @keyword.storage
(multiplicity) @keyword.modifier
(phaser name: _ @keyword.directive)

[
  "if" "elsif" "else" "unless" "with" "orwith" "without"
  "given" "when" "default"
] @keyword.conditional

[
  "for" "while" "until" "loop" "repeat" "whenever"
] @keyword.repeat

[
  "sub" "method" "submethod" "macro"
] @keyword.function

[
  "regex" "token" "rule"
] @keyword.function

[
  "class" "role" "grammar" "module" "package" "knowhow" "native" "slang"
  "unit" "enum" "subset" "constant"
] @keyword.type

[
  "use" "no" "need" "require" "import"
] @keyword.import

(statement_prefix prefix: _ @keyword)
(trait keyword: _ @keyword.modifier)
(statement_modifier modifier: _ @keyword.conditional)

[
  "where"
] @keyword.operator

(unary_expression operator: _ @operator)
(binary_expression operator: _ @operator)
(ternary_expression ["??" "!!"] @keyword.conditional.ternary)
(assignment operator: _ @operator)
(postfix_expression operator: _ @operator)
(reduce_operator) @operator
(whatever) @variable.builtin
(yada) @keyword.exception

[
  "->" "<->" "-->" "." ".=" "::("
] @operator

; Punctuation
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ";" ":"] @punctuation.delimiter
