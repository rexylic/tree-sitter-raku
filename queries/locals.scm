; Scopes
(block) @local.scope
(pointy_block) @local.scope
(routine_declaration) @local.scope
(package_declaration) @local.scope

; Definitions
(variable_declaration name: (variable) @local.definition)
(variable_declaration name: (sigilless_variable) @local.definition)
(parameter name: (variable) @local.definition)
(parameter name: (sigilless_variable) @local.definition)
(routine_declaration name: (identifier) @local.definition)

; References
(variable) @local.reference
