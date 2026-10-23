(routine_declaration name: (identifier) @name) @definition.function
(regex_declaration name: (identifier) @name) @definition.function
(package_declaration name: (identifier) @name) @definition.class
(unit_declaration name: (identifier) @name) @definition.class
(call_expression function: (identifier) @name) @reference.call
(listop_call function: (identifier) @name) @reference.call
(method_call method: (identifier) @name) @reference.call
