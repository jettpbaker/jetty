import type { ThemeRegistration } from '@pierre/diffs'

// Copied from Cursor's bundled theme-cursor extension (Cursor.app/Contents/Resources/app/extensions/theme-cursor):
// tokenColors as shipped, editor/diff/git colours kept. semanticTokenColors dropped.
export const cursorDark: ThemeRegistration = {
  name: 'cursor-dark',
  displayName: 'Cursor Dark',
  type: 'dark',
  colors: {
    'diffEditor.diagonalFill': '#F0F0F013',
    'diffEditor.insertedLineBackground': '#3FA26633',
    'diffEditor.insertedTextBackground': '#3FA26622',
    'diffEditor.removedLineBackground': '#B8004933',
    'diffEditor.removedTextBackground': '#B8004922',
    'editor.background': '#181818',
    'editor.findMatchBackground': '#88C0D066',
    'editor.findMatchHighlightBackground': '#88C0D044',
    'editor.findRangeHighlightBackground': '#F0F0F011',
    'editor.foreground': '#F0F0F0',
    'editor.hoverHighlightBackground': '#F0F0F01E',
    'editor.inactiveSelectionBackground': '#40404077',
    'editor.lineHighlightBackground': '#262626',
    'editor.lineHighlightBorder': '#262626',
    'editor.rangeHighlightBackground': '#40404052',
    'editor.selectionBackground': '#40404099',
    'editor.selectionHighlightBackground': '#404040CC',
    'editor.snippetFinalTabstopHighlightBorder': '#CCCCCC',
    'editor.snippetTabstopHighlightBackground': '#CCCCCC55',
    'editor.wordHighlightBackground': '#F0F0F01E',
    'editor.wordHighlightStrongBackground': '#F0F0F030',
    'editorBracketMatch.background': '#F0F0F01E',
    'editorBracketMatch.border': '#14141400',
    'editorCodeLens.foreground': '#F0F0F0BD',
    'editorCursor.foreground': '#F0F0F0',
    'editorError.border': '#E3467100',
    'editorError.foreground': '#E34671',
    'editorGroup.border': '#F0F0F013',
    'editorGroup.dropBackground': '#F0F0F011',
    'editorGroup.emptyBackground': '#141414',
    'editorGroupHeader.noTabsBackground': '#141414',
    'editorGroupHeader.tabsBackground': '#141414',
    'editorGroupHeader.tabsBorder': '#F0F0F013',
    'editorGutter.addedBackground': '#3FA266',
    'editorGutter.background': '#181818',
    'editorGutter.deletedBackground': '#E34671',
    'editorGutter.modifiedBackground': '#D2943E',
    'editorHoverWidget.background': '#141414',
    'editorHoverWidget.border': '#F0F0F026',
    'editorHoverWidget.foreground': '#F0F0F0',
    'editorIndentGuide.activeBackground1': '#F0F0F030',
    'editorIndentGuide.background1': '#F0F0F013',
    'editorInlayHint.background': '#00000000',
    'editorInlayHint.foreground': '#F0F0F05C',
    'editorInlayHint.parameterBackground': '#00000000',
    'editorInlayHint.parameterForeground': '#F0F0F05C',
    'editorInlayHint.typeBackground': '#00000000',
    'editorInlayHint.typeForeground': '#F0F0F05C',
    'editorLineNumber.activeForeground': '#F0F0F0',
    'editorLineNumber.foreground': '#F0F0F05C',
    'editorLink.activeForeground': '#F0F0F0',
    'editorMarkerNavigation.background': '#ffffff70',
    'editorMarkerNavigationError.background': '#E34671C0',
    'editorMarkerNavigationWarning.background': '#CCCCCC',
    'editorOverviewRuler.addedForeground': '#3FA26684',
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.deletedForeground': '#E3467184',
    'editorOverviewRuler.errorForeground': '#B80049',
    'editorOverviewRuler.findMatchForeground': '#F0F0F011',
    'editorOverviewRuler.modifiedForeground': '#B9790084',
    'editorRuler.foreground': '#F0F0F05C',
    'editorStickyScroll.border': '#F0F0F013',
    'editorSuggestWidget.background': '#141414',
    'editorSuggestWidget.border': '#F0F0F013',
    'editorSuggestWidget.foreground': '#F0F0F0',
    'editorSuggestWidget.highlightForeground': '#F0F0F0',
    'editorSuggestWidget.selectedBackground': '#343434',
    'editorWarning.border': '#F0F0F000',
    'editorWarning.foreground': '#F1B467',
    'editorWhitespace.foreground': '#505050B3',
    'editorWidget.background': '#141414',
    'editorWidget.resizeBorder': '#F0F0F026',
    'gitDecoration.addedResourceForeground': '#70B489',
    'gitDecoration.deletedResourceForeground': '#FC6B83',
    'gitDecoration.ignoredResourceForeground': '#F0F0F099',
    'gitDecoration.modifiedResourceForeground': '#F1B467',
    'gitDecoration.untrackedResourceForeground': '#88C0D0',
  },
  tokenColors: [
    {
      name: 'Python: Binary String (Single-Quoted)',
      scope: 'string.quoted.binary.single.python',
      settings: {
        foreground: '#a8cc7c',
      },
    },
    {
      name: 'C++: Boolean Literals',
      scope: ['constant.language.false.cpp', 'constant.language.true.cpp'],
      settings: {
        foreground: '#82d2ce',
      },
    },
    {
      name: 'Unison: Punctuation',
      scope:
        'punctuation.definition.delayed.unison,punctuation.definition.list.begin.unison,punctuation.definition.list.end.unison,punctuation.definition.ability.begin.unison,punctuation.definition.ability.end.unison,punctuation.operator.assignment.as.unison,punctuation.separator.pipe.unison,punctuation.separator.delimiter.unison,punctuation.definition.hash.unison',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Control Directive',
      scope: 'keyword.control.directive',
      settings: {
        foreground: '#a8cc7c',
      },
    },
    {
      name: 'Python: Ellipsis',
      scope: 'constant.other.ellipsis.python',
      settings: {
        foreground: '#CCCCCC',
      },
    },
    {
      name: 'Haskell: Generic Type Variable',
      scope: 'variable.other.generic-type.haskell',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'HTML: Tag Punctuation',
      scope: 'punctuation.definition.tag',
      settings: {
        foreground: '#A4A4A4',
      },
    },
    {
      name: 'Haskell: Storage Type',
      scope: 'storage.type.haskell',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Python: Magic Variable',
      scope: 'support.variable.magic.python',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Python: Parameter Punctuation',
      scope:
        'punctuation.separator.period.python,punctuation.separator.element.python,punctuation.parenthesis.begin.python,punctuation.parenthesis.end.python',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Python: Self Parameter',
      scope: 'variable.parameter.function.language.special.self.python',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'C++: This',
      scope: 'variable.language.this.cpp',
      settings: {
        foreground: '#82d2ce',
      },
    },
    {
      name: 'Rust: Lifetime Modifier',
      scope: 'storage.modifier.lifetime.rust',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Rust: Standard Function',
      scope: 'support.function.std.rust',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Rust: Lifetime Name',
      scope: 'entity.name.lifetime.rust',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Rust: Language Variable',
      scope: 'variable.language.rust',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Support Constant: Edge',
      scope: 'support.constant.edge',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'RegExp: Quantifier Operator',
      scope: 'keyword.operator.quantifier.regexp',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Strings',
      scope: ['string', 'punctuation.definition.string.begin', 'punctuation.definition.string.end'],
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Text',
      scope: 'variable.parameter.function',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Comment Markup Link',
      scope: 'comment markup.link',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Diff: Changed',
      scope: 'markup.changed.diff',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Diff: Header',
      scope:
        'meta.diff.header.from-file,meta.diff.header.to-file,punctuation.definition.from-file.diff,punctuation.definition.to-file.diff',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Diff: Inserted',
      scope: 'markup.inserted.diff',
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Diff: Deleted',
      scope: 'markup.deleted.diff',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C/C++: Function',
      scope: 'meta.function.c,meta.function.cpp',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C/C++: Block Punctuation',
      scope:
        'punctuation.section.block.begin.bracket.curly.cpp,punctuation.section.block.end.bracket.curly.cpp,punctuation.terminator.statement.c,punctuation.section.block.begin.bracket.curly.c,punctuation.section.block.end.bracket.curly.c,punctuation.section.parens.begin.bracket.round.c,punctuation.section.parens.end.bracket.round.c,punctuation.section.parameters.begin.bracket.round.c,punctuation.section.parameters.end.bracket.round.c',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JavaScript/TypeScript: Key-Value Separator',
      scope: 'punctuation.separator.key-value',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JavaScript/TypeScript: Import Operator',
      scope: 'keyword.operator.expression.import',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'JavaScript/TypeScript: Math',
      scope: 'support.constant.math',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'JavaScript/TypeScript: Math Property',
      scope: 'support.constant.property.math',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'JavaScript/TypeScript: Constant Variable',
      scope: 'variable.other.constant',
      settings: {
        foreground: '#AAA0FA',
      },
    },
    {
      name: 'Java: Types',
      scope: ['storage.type.annotation.java', 'storage.type.object.array.java'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Java: Source',
      scope: 'source.java',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Java: Punctuation and Blocks',
      scope:
        'punctuation.section.block.begin.java,punctuation.section.block.end.java,punctuation.definition.method-parameters.begin.java,punctuation.definition.method-parameters.end.java,meta.method.identifier.java,punctuation.section.method.begin.java,punctuation.section.method.end.java,punctuation.terminator.java,punctuation.section.class.begin.java,punctuation.section.class.end.java,punctuation.section.inner-class.begin.java,punctuation.section.inner-class.end.java,meta.method-call.java,punctuation.section.class.begin.bracket.curly.java,punctuation.section.class.end.bracket.curly.java,punctuation.section.method.begin.bracket.curly.java,punctuation.section.method.end.bracket.curly.java,punctuation.separator.period.java,punctuation.bracket.angle.java,punctuation.definition.annotation.java,meta.method.body.java',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Java: Method Meta',
      scope: 'meta.method.java',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Java: Modifiers and Types',
      scope: 'storage.modifier.import.java,storage.type.java,storage.type.generic.java',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Java: Instanceof Operator',
      scope: 'keyword.operator.instanceof.java',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Java: Variable Name',
      scope: 'meta.definition.variable.name.java',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Logical Operators',
      scope: 'keyword.operator.logical',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Bitwise Operators',
      scope: 'keyword.operator.bitwise',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Arithmetic Operators',
      scope: [
        'keyword.operator.arithmetic',
        'keyword.operator.comparison',
        'keyword.operator.decrement',
        'keyword.operator.increment',
        'keyword.operator.relational',
      ],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Channel Operator',
      scope: 'keyword.operator.channel',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'CSS/SCSS/LESS Operators',
      scope: 'keyword.operator.css,keyword.operator.scss,keyword.operator.less',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'CSS: Standard Color Name',
      scope: [
        'support.constant.color.w3c-standard-color-name.css',
        'support.constant.color.w3c-standard-color-name.scss',
      ],
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'CSS: Comma',
      scope: 'punctuation.separator.list.comma.css',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Module: Type Name',
      scope: ['entity.name.type.module', 'support.module.node', 'support.type.object.module'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'JavaScript: Variable (Read/Write)',
      scope: 'meta.object-literal.key,support.variable.object.process,support.variable.object.node',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'variable.other.readwrite',
      scope: 'variable.other.readwrite',
      settings: {
        foreground: '#87C3FF',
      },
    },
    {
      name: 'support.variable.property',
      scope: [
        'support.variable.property',
        'variable.other.property',
        'variable.other.property.ts',
        'meta.definition.property.ts',
      ],
      settings: {
        foreground: '#AAA0FA',
      },
    },
    {
      name: 'JSON: Constants',
      scope: 'support.constant.json',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Special Operators',
      scope: [
        'keyword.operator.expression.instanceof',
        'keyword.operator.new',
        'keyword.operator.ternary',
        'keyword.operator.optional',
        'keyword.operator.expression.keyof',
        'keyword.operator.expression.delete',
        'keyword.operator.expression.in',
        'keyword.operator.expression.of',
        'keyword.operator.expression.typeof',
        'keyword.operator.expression.void',
      ],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'JavaScript/TypeScript: Console Object',
      scope: 'support.type.object.console',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JavaScript/TypeScript: Process Property',
      scope: 'support.variable.property.process',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'JavaScript: Console Function',
      scope: 'entity.name.function.js,support.function.console.js',
      settings: {
        foreground: '#ebc88d',
      },
    },
    {
      name: 'keyword.operator.misc.rust',
      scope: 'keyword.operator.misc.rust',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'keyword.operator.sigil.rust',
      scope: 'keyword.operator.sigil.rust',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Operator: Delete',
      scope: 'keyword.operator.delete',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'DOM: Object',
      scope: 'support.type.object.dom',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'DOM: Variable/Property',
      scope: 'support.variable.dom,support.variable.property.dom',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C operator assignment',
      scope:
        'keyword.operator.assignment.c,keyword.operator.comparison.c,keyword.operator.c,keyword.operator.increment.c,keyword.operator.decrement.c,keyword.operator.bitwise.shift.c,keyword.operator.assignment.cpp,keyword.operator.comparison.cpp,keyword.operator.cpp,keyword.operator.increment.cpp,keyword.operator.decrement.cpp,keyword.operator.bitwise.shift.cpp',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Punctuation: Delimiter',
      scope: 'punctuation.separator.delimiter',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C/C++: Other Punctuation',
      scope: 'punctuation.separator.c,punctuation.separator.cpp',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'C/C++: POSIX-Reserved Type',
      scope: 'support.type.posix-reserved.c,support.type.posix-reserved.cpp',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C/C++: sizeof Operator',
      scope: 'keyword.operator.sizeof.c,keyword.operator.sizeof.cpp',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Python: Types',
      scope: 'support.type.python',
      settings: {
        foreground: '#82d2ce',
      },
    },
    {
      name: 'Python: Logical Operators',
      scope: 'keyword.operator.logical.python',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Python: Function Parameters',
      scope: ['variable.parameter.function.python', 'variable.parameter.function.language.python'],
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Python: Block Punctuation',
      scope:
        'punctuation.definition.arguments.begin.python,punctuation.definition.arguments.end.python,punctuation.separator.arguments.python,punctuation.definition.list.begin.python,punctuation.definition.list.end.python',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Python: Function Call (Generic)',
      scope: 'meta.function-call.generic.python',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Python: String Placeholder',
      scope: 'constant.character.format.placeholder.other.python',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Operators (All)',
      scope: 'keyword.operator',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Compound Assignment Operators',
      scope: 'keyword.operator.assignment.compound',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Compound Assignment Operators js/ts',
      scope: 'keyword.operator.assignment.compound.js,keyword.operator.assignment.compound.ts',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Keywords (All)',
      scope: 'keyword',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Namespaces',
      scope: 'entity.name.namespace',
      settings: {
        foreground: '#CCCCCC',
      },
    },
    {
      name: 'Variables (All)',
      scope: ['variable', 'variable.c'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Language Variables',
      scope: 'variable.language',
      settings: {
        foreground: '#CC7C8A',
      },
    },
    {
      name: 'Java: Variables',
      scope: 'token.variable.parameter.java',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Java: Imports',
      scope: 'import.storage.java',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Java: Package Keyword',
      scope: 'token.package.keyword',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Java: Package Identifier',
      scope: 'token.package',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Functions (All)',
      scope: ['entity.name.function', 'meta.require', 'support.function', 'variable.function'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Namespaces (All)',
      scope: 'entity.name.type.namespace',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Classes (All)',
      scope: 'support.class, entity.name.type.class',
      settings: {
        foreground: '#87c3ff',
      },
    },
    {
      name: 'Class Name',
      scope: [
        'entity.name.class',
        'variable.other.class.js',
        'variable.other.class.ts',
        'entity.name.class.identifier.namespace.type',
      ],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'PHP: Class Name',
      scope: 'variable.other.class.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Type Name',
      scope: 'entity.name.type',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Keyword Control',
      scope: 'keyword.control.directive.include.cpp',
      settings: {
        foreground: '#a8cc7c',
      },
    },
    {
      name: 'Control Elements',
      scope: 'control.elements, keyword.operator.less',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Methods',
      scope: 'keyword.other.special-method',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Storage',
      scope: ['storage', 'token.storage'],
      settings: {
        foreground: '#82d2ce',
      },
    },
    {
      scope: ['storage.modifier.reference', 'storage.modifier.pointer'],
      settings: {
        foreground: '#CCCCCC',
      },
    },
    {
      name: 'Java Storage',
      scope: 'token.storage.type.java',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Support',
      scope: 'support.function',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'CSS: Property Name',
      scope: 'meta.property-name.css',
      settings: {
        foreground: '#87c3ff',
      },
    },
    {
      name: 'Meta: Tag',
      scope: 'meta.tag',
      settings: {
        foreground: '#fad075',
      },
    },
    {
      name: 'Inherited Class',
      scope: 'entity.other.inherited-class',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Constant other symbol',
      scope: 'constant.other.symbol',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Integers',
      scope: 'constant.numeric',
      settings: {
        foreground: '#ebc88d',
      },
    },
    {
      name: 'CSS: Color Constant',
      scope: 'constant.other.color',
      settings: {
        foreground: '#ebc88d',
      },
    },
    {
      name: 'Constants',
      scope: 'punctuation.definition.constant',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Vue: Tags',
      scope: ['entity.name.tag.template', 'entity.name.tag.script', 'entity.name.tag.style'],
      settings: {
        foreground: '#AAA0FA',
      },
    },
    {
      name: 'HTML: Tag',
      scope: ['entity.name.tag.html'],
      settings: {
        foreground: '#87c3ff',
      },
    },
    {
      name: 'css property value',
      scope: 'meta.property-value.css',
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Attributes',
      scope: 'entity.other.attribute-name',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Attribute IDs',
      scope: 'entity.other.attribute-name.id',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'CSS: Attribute Class',
      scope: 'entity.other.attribute-name.class.css',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Selector',
      scope: 'meta.selector',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Headings',
      scope: 'markup.heading',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Headings',
      scope: 'markup.heading punctuation.definition.heading, entity.name.section',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Units',
      scope: 'keyword.other.unit',
      settings: {
        foreground: '#ebc88d',
      },
    },
    {
      name: 'Markdown: Bold Text',
      scope: 'markup.bold,todo.bold',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Markdown: Bold Punctuation',
      scope: 'punctuation.definition.bold',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Markdown: Italic',
      scope: 'markup.italic, punctuation.definition.italic,todo.emphasis',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Markdown: Emphasis',
      scope: 'emphasis md',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Markdown: Headings',
      scope: 'entity.name.section.markdown',
      settings: {
        foreground: '#88C0D0',
      },
    },
    {
      name: 'Markdown: Heading Punctuation',
      scope: 'punctuation.definition.heading.markdown',
      settings: {
        foreground: '#F0F0F099',
      },
    },
    {
      name: 'Markdown: Setext Headings',
      scope: 'markup.heading.setext',
      settings: {
        foreground: '#88C0D0',
      },
    },
    {
      name: 'Markdown: Bold Punctuation',
      scope: 'punctuation.definition.bold.markdown',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Markdown: Inline Raw',
      scope: 'markup.inline.raw.markdown, markup.inline.raw.string.markdown',
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Markdown: List Punctuation',
      scope: [
        'punctuation.definition.list.begin.markdown',
        'punctuation.definition.list.markdown',
        'beginning.punctuation.definition.list.markdown',
      ],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Markdown: String Punctuation',
      scope: [
        'punctuation.definition.string.begin.markdown',
        'punctuation.definition.string.end.markdown',
        'punctuation.definition.metadata.markdown',
      ],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Markdown: Metadata Punctuation',
      scope: 'punctuation.definition.metadata.markdown',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Markdown: Underline Link and Image',
      scope: 'markup.underline.link.markdown,markup.underline.link.image.markdown',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Markdown: Link Title and Description',
      scope: 'string.other.link.title.markdown,string.other.link.description.markdown',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Regular Expressions',
      scope: 'string.regexp',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Escape Characters',
      scope: 'constant.character.escape',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Embedded',
      scope: 'variable.interpolation',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Embedded',
      scope: 'punctuation.section.embedded.begin,punctuation.section.embedded.end',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Invalid',
      scope:
        'invalid.illegal, invalid.illegal.bad-ampersand.html, invalid.broken, invalid.deprecated, invalid.unimplemented',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Source Json Meta Structure Dictionary Json > String Quoted Json',
      scope: 'source.json meta.structure.dictionary.json > string.quoted.json',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Source Json Meta Structure Dictionary Json > String Quoted Json > Punctuation String',
      scope: 'source.json meta.structure.dictionary.json > string.quoted.json > punctuation.string',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Source Json Meta Structure Dictionary Json > Value Json > String Quoted Json,source Json Meta Structure Array Json > Value Json > String Quoted Json,source Json Meta Structure Dictionary Json > Value Json > String Quoted Json > Punctuation,source Json Meta Structure Array Json > Value Json > String Quoted Json > Punctuation',
      scope:
        'source.json meta.structure.dictionary.json > value.json > string.quoted.json,source.json meta.structure.array.json > value.json > string.quoted.json,source.json meta.structure.dictionary.json > value.json > string.quoted.json > punctuation,source.json meta.structure.array.json > value.json > string.quoted.json > punctuation',
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Source Json Meta Structure Dictionary Json > Constant Language Json,source Json Meta Structure Array Json > Constant Language Json',
      scope:
        'source.json meta.structure.dictionary.json > constant.language.json,source.json meta.structure.array.json > constant.language.json',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JSON: Property Name',
      scope: 'support.type.property-name.json',
      settings: {
        foreground: '#82d2ce',
      },
    },
    {
      name: 'Laravel Blade Tag and @',
      scope: ['entity.name.tag.laravel-blade', 'support.constant.laravel-blade'],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'PHP: Use Statement',
      scope:
        'support.other.namespace.use.php,support.other.namespace.use-as.php,support.other.namespace.php,entity.other.alias.php,meta.interface.php',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'PHP: Error Suppression',
      scope: 'keyword.operator.error-control.php',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'PHP: Instanceof Operator',
      scope: 'keyword.operator.type.php',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'PHP: Array Index Begin (Double-Quoted)',
      scope: 'punctuation.section.array.begin.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'PHP: Array Index End (Double-Quoted)',
      scope: 'punctuation.section.array.end.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'PHP: Illegal Non-Null Typehinted',
      scope: 'invalid.illegal.non-null-typehinted.php',
      settings: {
        foreground: '#F14C4C',
      },
    },
    {
      name: 'PHP: Types',
      scope:
        'storage.type.php,meta.other.type.phpdoc.php,keyword.other.type.php,keyword.other.array.phpdoc.php',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'PHP: Function Call',
      scope: 'meta.function-call.php,meta.function-call.object.php,meta.function-call.static.php',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'PHP: Function/Block Punctuation',
      scope:
        'punctuation.definition.parameters.begin.bracket.round.php,punctuation.definition.parameters.end.bracket.round.php,punctuation.separator.delimiter.php,punctuation.section.scope.begin.php,punctuation.section.scope.end.php,punctuation.terminator.expression.php,punctuation.definition.arguments.begin.bracket.round.php,punctuation.definition.arguments.end.bracket.round.php,punctuation.definition.storage-type.begin.bracket.round.php,punctuation.definition.storage-type.end.bracket.round.php,punctuation.definition.array.begin.bracket.round.php,punctuation.definition.array.end.bracket.round.php,punctuation.definition.begin.bracket.round.php,punctuation.definition.end.bracket.round.php,punctuation.definition.begin.bracket.curly.php,punctuation.definition.end.bracket.curly.php,punctuation.definition.section.switch-block.end.bracket.curly.php,punctuation.definition.section.switch-block.start.bracket.curly.php,punctuation.definition.section.switch-block.begin.bracket.curly.php,punctuation.definition.section.switch-block.end.bracket.curly.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Rust: Core Constants',
      scope: 'support.constant.core.rust',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'PHP: Constants',
      scope:
        'support.constant.ext.php,support.constant.std.php,support.constant.core.php,support.constant.parser-token.php',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'PHP Goto',
      scope: 'entity.name.goto-label.php,support.other.php',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'PHP Logical/Bitwise Operator',
      scope:
        'keyword.operator.logical.php,keyword.operator.bitwise.php,keyword.operator.arithmetic.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'PHP Regexp Operator',
      scope: 'keyword.operator.regexp.php',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'PHP Comparison',
      scope: 'keyword.operator.comparison.php',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'PHP Heredoc/Nowdoc',
      scope: 'keyword.operator.heredoc.php,keyword.operator.nowdoc.php',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Python Decorator',
      scope: [
        'meta.function.decorator.python',
        'punctuation.definition.decorator.python',
        'entity.name.function.decorator.python',
      ],
      settings: {
        foreground: '#a8cc7c',
      },
    },
    {
      name: 'Python: Decorator Support',
      scope: 'support.token.decorator.python,meta.function.decorator.identifier.python',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Function: Braces',
      scope: 'function.brace',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Parameter Function',
      scope: ['function.parameter', 'function.parameter.ruby', 'function.parameter.cs'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Ruby: Symbol',
      scope: 'constant.language.symbol.ruby',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'RGB Value',
      scope: 'rgb-value',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'RGB Value (Inline)',
      scope: 'inline-color-decoration rgb-value',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'RGB Value (Less)',
      scope: 'less rgb-value',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Sass: Selector',
      scope: 'selector.sass',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'TypeScript: Primitive/Builtin Types',
      scope:
        'support.type.primitive.ts,support.type.builtin.ts,support.type.primitive.tsx,support.type.builtin.tsx',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Block Scope',
      scope: 'block.scope.end,block.scope.begin',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'C#: Storage Type',
      scope: 'storage.type.cs',
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'C#: Local Variable',
      scope: 'entity.name.variable.local.cs',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Diagnostics: Info',
      scope: 'token.info-token',
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Diagnostics: Warning',
      scope: 'token.warn-token',
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Diagnostics: Error',
      scope: 'token.error-token',
      settings: {
        foreground: '#F14C4C',
      },
    },
    {
      name: 'Diagnostics: Debug',
      scope: 'token.debug-token',
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'String interpolation',
      scope: [
        'punctuation.definition.template-expression.begin',
        'punctuation.definition.template-expression.end',
        'punctuation.section.embedded',
      ],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Reset JavaScript string interpolation expression',
      scope: ['meta.template.expression'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Import module JS',
      scope: ['keyword.operator.module'],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'JS Flowtype',
      scope: ['support.type.type.flowtype'],
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'JS Flow',
      scope: ['support.type.primitive'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'JS Class Prop',
      scope: ['meta.property.object'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JS Func Parameter',
      scope: ['variable.parameter.function.js'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JS Template Literal Punctuation',
      scope: [
        'keyword.other.template.begin',
        'keyword.other.template.end',
        'keyword.other.substitution.begin',
        'keyword.other.substitution.end',
      ],
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'js operator.assignment',
      scope: ['keyword.operator.assignment'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Go: Assignment Operators',
      scope: ['keyword.operator.assignment.go'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Go: Arithmetic and Address Operators',
      scope: ['keyword.operator.arithmetic.go', 'keyword.operator.address.go'],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Go package name',
      scope: ['entity.name.package.go'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'elm prelude',
      scope: ['support.type.prelude.elm'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'elm constant',
      scope: ['support.constant.elm'],
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'template literal',
      scope: ['punctuation.quasi.element'],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'html/pug (jade) escaped characters and entities',
      scope: ['constant.character.entity'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'styling css pseudo-elements/classes to be able to differentiate from classes which are the same colour',
      scope: [
        'entity.other.attribute-name.pseudo-element',
        'entity.other.attribute-name.pseudo-class',
      ],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Clojure globals',
      scope: ['entity.global.clojure'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Clojure symbols',
      scope: ['meta.symbol.clojure'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Clojure constants',
      scope: ['constant.keyword.clojure'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'CoffeeScript Function Argument',
      scope: ['meta.arguments.coffee', 'variable.parameter.function.coffee'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Ini Default Text',
      scope: ['source.ini'],
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Makefile prerequisities',
      scope: ['meta.scope.prerequisites.makefile'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Makefile text colour',
      scope: ['source.makefile'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Groovy import names',
      scope: ['storage.modifier.import.groovy'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Groovy Methods',
      scope: ['meta.method.groovy'],
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Groovy Variables',
      scope: ['meta.definition.variable.name.groovy'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Groovy Inheritance',
      scope: ['meta.definition.class.inherited.classes.groovy'],
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'HLSL Semantic',
      scope: ['support.variable.semantic.hlsl'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'HLSL Types',
      scope: [
        'support.type.texture.hlsl',
        'support.type.sampler.hlsl',
        'support.type.object.hlsl',
        'support.type.object.rw.hlsl',
        'support.type.fx.hlsl',
        'support.type.object.hlsl',
      ],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'SQL Variables',
      scope: ['text.variable', 'text.bracketed'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Swift/VB ASP: Types',
      scope: ['support.type.swift', 'support.type.vb.asp'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Xi: Heading 1 (Keyword)',
      scope: ['entity.name.function.xi'],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Xi: Heading 2 (Callable)',
      scope: ['entity.name.class.xi'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Xi: Heading 3 (Property)',
      scope: ['constant.character.character-class.regexp.xi'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Xi: Heading 4 (Type/Class/Interface)',
      scope: ['constant.regexp.xi'],
      settings: {
        foreground: '#82D2CE',
      },
    },
    {
      name: 'Xi: Heading 5 (Enums/Preprocessor/Constant/Decorator)',
      scope: ['keyword.control.xi'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Xi: Heading 6 (Number)',
      scope: ['invalid.xi'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Xi: String',
      scope: ['beginning.punctuation.definition.quote.markdown.xi'],
      settings: {
        foreground: '#e394dc',
      },
    },
    {
      name: 'Xi: Markdown List Punctuation',
      scope: ['beginning.punctuation.definition.list.markdown.xi'],
      settings: {
        foreground: '#F0F0F099',
      },
    },
    {
      name: 'Xi: Link Character',
      scope: ['constant.character.xi'],
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Xi: Accent',
      scope: ['accent.xi'],
      settings: {
        foreground: '#aaa0fa',
      },
    },
    {
      name: 'Xi: Wikiword',
      scope: ['wikiword.xi'],
      settings: {
        foreground: '#f8c762',
      },
    },
    {
      name: 'Xi: Language Operators',
      scope: ['constant.other.color.rgb-value.xi'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Xi: Dimmed Elements',
      scope: ['punctuation.definition.tag.xi'],
      settings: {
        foreground: '#F0F0F099',
      },
    },
    {
      name: 'C#/C++: Labels and Scope Resolution',
      scope: [
        'entity.name.label.cs',
        'entity.name.scope-resolution.function.call',
        'entity.name.scope-resolution.function.definition',
      ],
      settings: {
        foreground: '#efb080',
      },
    },
    {
      name: 'Markdown: Setext Headers (CS)',
      scope: [
        'entity.name.label.cs',
        'markup.heading.setext.1.markdown',
        'markup.heading.setext.2.markdown',
      ],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'meta.brace.square',
      scope: 'meta.brace.square',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Comment',
      scope:
        'comment, punctuation.definition.comment, comment.line.double-slash, comment.block.documentation',
      settings: {
        fontStyle: 'italic',
        foreground: '#F0F0F099',
      },
    },
    {
      name: 'Markdown: Quote',
      scope: 'markup.quote.markdown',
      settings: {
        foreground: '#F0F0F099',
      },
    },
    {
      name: 'punctuation.definition.block.sequence.item.yaml',
      scope: 'punctuation.definition.block.sequence.item.yaml',
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'Elixir: Symbol',
      scope: ['constant.language.symbol.elixir'],
      settings: {
        foreground: '#d6d6dd',
      },
    },
    {
      name: 'JavaScript/TypeScript: Italic',
      scope:
        'entity.other.attribute-name.js,entity.other.attribute-name.ts,entity.other.attribute-name.jsx,entity.other.attribute-name.tsx,variable.parameter,variable.language.super',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'Python Keyword Control',
      scope: 'keyword.control.import.python,keyword.control.flow.python',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'markup.italic.markdown',
      scope: 'markup.italic.markdown',
      settings: {
        fontStyle: 'italic',
      },
    },
  ],
}

export const cursorLight: ThemeRegistration = {
  name: 'cursor-light',
  displayName: 'Cursor Light',
  type: 'light',
  colors: {
    'diffEditor.insertedLineBackground': '#00AF6624',
    'diffEditor.insertedTextBackground': '#00B06838',
    'diffEditor.removedLineBackground': '#FF617B38',
    'diffEditor.removedTextBackground': '#FF617B57',
    'diffEditor.unchangedCodeBackground': '#FCFCFC00',
    'editor.background': '#FCFCFC',
    'editor.findMatchBackground': '#3B7E843D',
    'editor.findMatchHighlightBackground': '#3B7E8424',
    'editor.findRangeHighlightBackground': '#14141414',
    'editor.foreground': '#141414',
    'editor.hoverHighlightBackground': '#14141424',
    'editor.inactiveSelectionBackground': '#14141414',
    'editor.lineHighlightBackground': '#EAEAEA',
    'editor.lineHighlightBorder': '#EAEAEA',
    'editor.rangeHighlightBackground': '#3B7E8424',
    'editor.selectionBackground': '#14141414',
    'editor.selectionHighlightBackground': '#3B7E8424',
    'editor.snippetFinalTabstopHighlightBorder': '#1414141F',
    'editor.snippetTabstopHighlightBackground': '#14141424',
    'editor.wordHighlightBackground': '#14141424',
    'editor.wordHighlightStrongBackground': '#1414140F',
    'editorBracketHighlight.foreground1': '#004078',
    'editorBracketHighlight.foreground2': '#0064B0',
    'editorBracketHighlight.foreground3': '#2778C1',
    'editorBracketHighlight.foreground4': '#7A0055',
    'editorBracketHighlight.foreground5': '#A6317E',
    'editorBracketHighlight.foreground6': '#B54E90',
    'editorBracketHighlight.unexpectedBracket.foreground': '#BE1744',
    'editorBracketMatch.background': '#14141424',
    'editorBracketMatch.border': '#FCFCFC00',
    'editorCodeLens.foreground': '#141414BD',
    'editorCursor.foreground': '#141414',
    'editorError.border': '#BE174400',
    'editorError.foreground': '#BE1744',
    'editorGroup.border': '#14141414',
    'editorGroup.dropBackground': '#14141414',
    'editorGroup.emptyBackground': '#F3F3F3',
    'editorGroupHeader.noTabsBackground': '#F3F3F3',
    'editorGroupHeader.tabsBackground': '#F3F3F3',
    'editorGroupHeader.tabsBorder': '#14141414',
    'editorGutter.addedBackground': '#007041',
    'editorGutter.background': '#FCFCFC',
    'editorGutter.deletedBackground': '#BE1744',
    'editorGutter.modifiedBackground': '#A46700',
    'editorHoverWidget.background': '#F3F3F3',
    'editorHoverWidget.border': '#14141433',
    'editorHoverWidget.foreground': '#141414',
    'editorIndentGuide.activeBackground1': '#14141433',
    'editorIndentGuide.background1': '#14141414',
    'editorInlayHint.background': '#FCFCFC00',
    'editorInlayHint.foreground': '#141414BD',
    'editorInlayHint.parameterBackground': '#FCFCFC00',
    'editorInlayHint.parameterForeground': '#14141499',
    'editorInlayHint.typeBackground': '#FCFCFC00',
    'editorInlayHint.typeForeground': '#14141499',
    'editorLineNumber.activeForeground': '#141414BD',
    'editorLineNumber.foreground': '#1414145C',
    'editorLink.activeForeground': '#141414',
    'editorMarkerNavigation.background': '#1414144D',
    'editorMarkerNavigationError.background': '#BE1744C0',
    'editorMarkerNavigationWarning.background': '#141414BD',
    'editorOverviewRuler.border': '#FCFCFC00',
    'editorRuler.foreground': '#14141433',
    'editorStickyScroll.border': '#14141414',
    'editorSuggestWidget.background': '#F3F3F3',
    'editorSuggestWidget.border': '#14141414',
    'editorSuggestWidget.foreground': '#141414BD',
    'editorSuggestWidget.highlightForeground': '#141414',
    'editorSuggestWidget.selectedBackground': '#14141414',
    'editorUnnecessaryCode.opacity': '#0000007F',
    'editorWarning.border': '#FCFCFC00',
    'editorWarning.foreground': '#CD4500',
    'editorWhitespace.foreground': '#1414144D',
    'editorWidget.background': '#F3F3F3',
    'editorWidget.foreground': '#141414BD',
    'editorWidget.resizeBorder': '#14141433',
    'gitDecoration.addedResourceForeground': '#007041',
    'gitDecoration.deletedResourceForeground': '#BE1744',
    'gitDecoration.ignoredResourceForeground': '#14141499',
    'gitDecoration.modifiedResourceForeground': '#A46700',
    'gitDecoration.untrackedResourceForeground': '#176C74',
  },
  tokenColors: [
    {
      name: 'Comments',
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: {
        foreground: '#14141499',
        fontStyle: 'italic',
      },
    },
    {
      name: 'Strings',
      scope: ['string', 'string punctuation.section.embedded source'],
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'String Punctuation',
      scope: 'punctuation.definition.string.begin,punctuation.definition.string.end',
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'Variables in Strings',
      scope: 'string variable',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'String interpolation delimiters',
      scope: [
        'punctuation.definition.template-expression.begin',
        'punctuation.definition.template-expression.end',
        'punctuation.section.embedded',
      ],
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Template Expression Contents',
      scope: 'meta.template.expression',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Regular Expressions',
      scope: ['source.regexp', 'string.regexp'],
      settings: {
        foreground: '#0064B0',
      },
    },
    {
      name: 'Regex Operators, Classes & Escapes',
      scope: [
        'keyword.operator.quantifier.regexp',
        'keyword.operator.negation.regexp',
        'keyword.operator.alternation.regexp',
        'keyword.operator.or.regexp',
        'keyword.control.anchor.regexp',
        'constant.character.escape.backslash.regexp',
        'constant.character.escape.regexp',
        'string.regexp constant.character.escape',
        'constant.other.character-class.regexp',
        'constant.other.character-class.set.regexp',
        'constant.other.character-class.range.regexp',
        'constant.character.character-class.regexp',
        'constant.character.set.regexp',
        'support.other.escape.special.regexp',
      ],
      settings: {
        foreground: '#AE3C00',
      },
    },
    {
      name: 'Regex Punctuation',
      scope: [
        'punctuation.definition.group.regexp',
        'punctuation.definition.group.assertion.regexp',
        'punctuation.definition.character-class.regexp',
        'punctuation.character.set.begin.regexp',
        'punctuation.character.set.end.regexp',
        'support.other.parenthesis.regexp',
      ],
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Character Constants & Placeholders',
      scope: ['constant.other.placeholder', 'constant.character'],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Constants',
      scope: [
        'constant',
        'entity.name.constant',
        'variable.other.constant',
        'variable.other.enummember',
      ],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Integers',
      scope: 'constant.numeric',
      settings: {
        foreground: '#92156A',
      },
    },
    {
      name: 'Support Constants',
      scope: 'support.constant',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Language variables',
      scope: 'variable.language',
      settings: {
        foreground: '#BE1744',
      },
    },
    {
      name: 'Support Variables',
      scope: 'support.variable',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Variables (Readwrite)',
      scope: 'variable.other.readwrite',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Parameters',
      scope: 'variable.parameter',
      settings: {
        foreground: '#141414',
        fontStyle: 'italic',
      },
    },
    {
      name: 'Keywords',
      scope: 'keyword',
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Storage Types & Modifiers',
      scope: ['storage', 'storage.type'],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Structural Keywords',
      scope: ['storage.type', 'storage.modifier', 'variable.language'],
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'Go and Rust Declaration Keywords',
      scope: [
        'keyword.function.go',
        'keyword.var.go',
        'keyword.const.go',
        'keyword.type.go',
        'keyword.struct.go',
        'keyword.interface.go',
        'keyword.package.go',
        'keyword.other.fn.rust',
      ],
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'Upright Storage Exceptions',
      scope: [
        'storage.type.function.arrow',
        'storage.type.numeric.bigint',
        'storage.type.built-in',
        'storage.type.primitive',
        'storage.type.numeric.go',
        'storage.type.string.go',
        'storage.type.boolean.go',
        'storage.type.byte.go',
        'storage.type.rune.go',
        'storage.type.error.go',
        'storage.type.uintptr.go',
        'storage.type.java',
        'storage.type.generic.java',
        'storage.type.object.array.java',
        'storage.type.annotation.java',
        'storage.type.php',
        'storage.modifier.import',
        'storage.modifier.package',
        'storage.modifier.pointer',
        'storage.modifier.reference',
        'storage.modifier.lifetime.rust',
      ],
      settings: {
        fontStyle: '',
      },
    },
    {
      name: 'Preprocessor Directives',
      scope: 'keyword.control.directive',
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Function Names (Implementations)',
      scope: 'entity.name.function',
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Functions (Implementations)',
      scope: ['support.function', 'variable.function', 'entity.global.clojure'],
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Labels',
      scope: ['entity.name.label', 'entity.name.goto-label'],
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Decorators',
      scope: [
        'punctuation.decorator',
        'punctuation.definition.decorator.python',
        'entity.name.function.decorator.python',
      ],
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Classes',
      scope: [
        'support.class',
        'entity.name.type.class',
        'entity.name.type.namespace',
        'entity.name.type',
        'entity.name.namespace',
        'support.other.namespace.php',
        'entity.other.alias.php',
        'meta.other.type.phpdoc.php',
        'variable.other.generic-type.haskell',
      ],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Class name',
      scope: 'entity.name.class',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Inherited / Base Classes & Scope Resolution',
      scope: [
        'entity.other.inherited-class',
        'entity.name.scope-resolution',
        'meta.definition.class.inherited.classes.groovy',
      ],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Support Types & Class References',
      scope: ['support.type', 'variable.other.class'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Type Name Underline',
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.namespace',
        'entity.name.scope-resolution',
        'entity.other.inherited-class',
      ],
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      name: 'Symbol Operators',
      scope: 'keyword.operator',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Word Operators',
      scope: [
        'keyword.operator.new',
        'keyword.operator.delete',
        'keyword.operator.typeof',
        'keyword.operator.instanceof',
        'keyword.operator.in',
        'keyword.operator.of',
        'keyword.operator.sizeof',
        'keyword.operator.expression.instanceof',
        'keyword.operator.expression.typeof',
        'keyword.operator.expression.delete',
        'keyword.operator.expression.in',
        'keyword.operator.expression.of',
        'keyword.operator.expression.void',
        'keyword.operator.expression.keyof',
        'keyword.operator.expression.import',
        'keyword.operator.expression.is',
        'keyword.operator.expression.extends',
        'keyword.operator.expression.infer',
        'keyword.operator.type.asserts',
        'keyword.operator.type.php',
        'keyword.operator.module',
        'keyword.operator.logical.python',
      ],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'HTML/XML Tags & Components',
      scope: ['entity.name.tag', 'support.class.component'],
      settings: {
        foreground: '#007041',
      },
    },
    {
      name: 'HTML/XML Tag Punctuation',
      scope: [
        'punctuation.definition.tag.begin.html',
        'punctuation.definition.tag.end.html',
        'punctuation.definition.tag.begin.xml',
        'punctuation.definition.tag.end.xml',
        'punctuation.definition.tag',
      ],
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Attributes',
      scope: 'entity.other.attribute-name',
      settings: {
        foreground: '#481B9C',
      },
    },
    {
      name: 'CSS Class Names',
      scope: 'entity.other.attribute-name.class.css',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'CSS Property Names',
      scope: [
        'support.type.property-name.css',
        'support.type.property-name',
        'support.type.vendored.property-name',
        'meta.property-name.css',
        'meta.property-name.scss',
      ],
      settings: {
        foreground: '#481B9C',
      },
    },
    {
      name: 'CSS Property Values',
      scope: 'meta.property-value.css',
      settings: {
        foreground: '#004078',
      },
    },
    {
      name: 'CSS Selectors',
      scope: 'meta.selector',
      settings: {
        foreground: '#3B7E84',
      },
    },
    {
      name: 'CSS Units',
      scope: 'keyword.other.unit',
      settings: {
        foreground: '#B54E90',
      },
    },
    {
      name: 'CSS Color Values',
      scope: 'constant.other.color',
      settings: {
        foreground: '#92156A',
      },
    },
    {
      name: 'CSS Hex Color Hashtag',
      scope: 'punctuation.definition.constant.css',
      settings: {
        foreground: '#B54E90',
      },
    },
    {
      name: 'JS/TS Modules',
      scope: 'support.module.node,support.type.object.module',
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'JS/TS JSON Constants',
      scope: 'support.constant.json',
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'JS/TS Process Properties',
      scope: 'support.variable.property.process',
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'JS DOM Variables & Properties',
      scope: ['support.variable.dom', 'support.variable.property.dom'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Flow Type Annotations',
      scope: ['support.type.type.flowtype'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Primitive Types',
      scope: ['support.type.primitive'],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Property Access',
      scope: [
        'support.variable.property',
        'variable.other.property',
        'variable.other.property.ts',
        'variable.other.object.property',
      ],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Keys and Field Declarations',
      scope: [
        'meta.object-literal.key',
        'meta.definition.property',
        'meta.definition.property.ts',
        'variable.object.property',
        'meta.property.object',
        'entity.name.variable.field.cs',
        'entity.name.variable.property.cs',
      ],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'JS Template Literal Begin',
      scope: ['keyword.other.template.begin'],
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'JS Template Literal End',
      scope: ['keyword.other.template.end'],
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'JS Template Substitution Begin',
      scope: ['keyword.other.substitution.begin'],
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'JS Template Substitution End',
      scope: ['keyword.other.substitution.end'],
      settings: {
        foreground: '#7565CC',
      },
    },
    {
      name: 'Python Types',
      scope: 'support.type.python',
      settings: {
        foreground: '#005293',
        fontStyle: 'underline',
      },
    },
    {
      name: 'Python Ellipsis',
      scope: 'constant.other.ellipsis.python',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Python Magic Variables',
      scope: 'support.variable.magic.python',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Python Punctuation',
      scope:
        'punctuation.separator.period.python,punctuation.separator.element.python,punctuation.parenthesis.begin.python,punctuation.parenthesis.end.python',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Python self Parameter',
      scope: 'variable.parameter.function.language.special.self.python',
      settings: {
        foreground: '#BE1744',
      },
    },
    {
      name: 'Python Block Punctuation',
      scope:
        'punctuation.definition.arguments.begin.python,punctuation.definition.arguments.end.python,punctuation.separator.arguments.python,punctuation.definition.list.begin.python,punctuation.definition.list.end.python',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Python Function Calls',
      scope: 'meta.function-call.generic.python',
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'C/C++ Types',
      scope: ['support.type.posix-reserved.c', 'support.type.posix-reserved.cpp'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Reference & Pointer Modifiers',
      scope: ['storage.modifier.reference', 'storage.modifier.pointer'],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'C Variables',
      scope: 'variable.c',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Java Package & Import Modifiers',
      scope: ['storage.modifier.package', 'storage.modifier.import'],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Java Variables',
      scope: 'variable.parameter.java',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Java Imports & Generics',
      scope: [
        'storage.modifier.import.java',
        'storage.modifier.import.groovy',
        'storage.type.generic.java',
      ],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Java Types & Arrays',
      scope: ['storage.type.annotation.java', 'storage.type.object.array.java'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Java Storage',
      scope: 'storage.type.java',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'JSON Property Names',
      scope: 'support.type.property-name.json',
      settings: {
        foreground: '#007041',
      },
    },
    {
      name: 'Markdown Headings',
      scope: ['markup.heading', 'markup.heading entity.name'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Markdown Section Headings',
      scope: ['entity.name.section.markdown', 'entity.name.section', 'markup.heading.setext'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Markdown Quotes',
      scope: 'markup.quote',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Markdown Quote Punctuation',
      scope: 'punctuation.definition.quote.begin.markdown',
      settings: {
        foreground: '#14141499',
      },
    },
    {
      name: 'Markdown Italic',
      scope: 'markup.italic',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'Markdown Bold',
      scope: 'markup.bold',
      settings: {
        fontStyle: 'bold',
      },
    },
    {
      name: 'Todo Bold',
      scope: 'todo.bold',
      settings: {
        fontStyle: 'bold',
      },
    },
    {
      name: 'Todo Italic',
      scope: 'todo.emphasis',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      name: 'Markdown Underline',
      scope: ['markup.underline'],
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      name: 'Markdown Strikethrough',
      scope: ['markup.strikethrough', 'punctuation.definition.strikethrough'],
      settings: {
        foreground: '#14141499',
        fontStyle: 'strikethrough',
      },
    },
    {
      name: 'Markdown Inline Code',
      scope: 'markup.inline.raw',
      settings: {
        foreground: '#007041',
      },
    },
    {
      name: 'Markdown Heading Punctuation',
      scope: 'markup.heading punctuation.definition.heading',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'punctuation.definition.list.begin.markdown',
      scope: 'punctuation.definition.list.begin.markdown',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: '[VSCODE-CUSTOM] Markdown List Punctuation Definition',
      scope: 'punctuation.definition.list.markdown',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: '[VSCODE-CUSTOM] Markdown Punctuation Definition String',
      scope: [
        'punctuation.definition.string.begin.markdown',
        'punctuation.definition.string.end.markdown',
        'punctuation.definition.metadata.markdown',
      ],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'beginning.punctuation.definition.list.markdown',
      scope: ['beginning.punctuation.definition.list.markdown'],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: '[VSCODE-CUSTOM] Markdown Underline Link/Image',
      scope: 'markup.underline.link.markdown,markup.underline.link.image.markdown',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Markdown Link Title/Description',
      scope: 'string.other.link.title.markdown,string.other.link.description.markdown',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Punctuation',
      scope:
        'punctuation.definition.bold, punctuation.definition.italic, punctuation.definition.underline',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Diff - Deleted',
      scope: ['markup.deleted', 'meta.diff.header.from-file', 'punctuation.definition.deleted'],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Diff - Inserted',
      scope: ['markup.inserted', 'meta.diff.header.to-file', 'punctuation.definition.inserted'],
      settings: {
        foreground: '#007041',
      },
    },
    {
      name: 'Diff - Changed',
      scope: ['markup.changed', 'punctuation.definition.changed'],
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Diff - Ignored/Untracked',
      scope: ['markup.ignored', 'markup.untracked'],
      settings: {
        foreground: '#14141499',
      },
    },
    {
      name: 'Diff - Range',
      scope: 'meta.diff.range',
      settings: {
        foreground: '#654DC0',
      },
    },
    {
      name: 'Diff - Header',
      scope: 'meta.diff.header',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Go Package Names',
      scope: ['entity.name.package.go'],
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'punctuation.definition.block.sequence.item.yaml',
      scope: 'punctuation.definition.block.sequence.item.yaml',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Elixir Symbols',
      scope: ['constant.language.symbol.elixir'],
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Invalid',
      scope: [
        'invalid',
        'invalid.broken',
        'invalid.deprecated',
        'invalid.illegal',
        'invalid.unimplemented',
      ],
      settings: {
        fontStyle: 'italic',
        foreground: '#A30034',
      },
    },
    {
      name: 'Carriage Return',
      scope: 'carriage-return',
      settings: {
        fontStyle: 'italic underline',
        foreground: '#1414140F',
      },
    },
    {
      name: 'Error Messages',
      scope: 'message.error',
      settings: {
        foreground: '#A30034',
      },
    },
    {
      name: 'Output/Debug Token - Info',
      scope: 'token.info-token',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Output/Debug Token - Warning',
      scope: 'token.warn-token',
      settings: {
        foreground: '#8B5700',
      },
    },
    {
      name: 'Output/Debug Token - Error',
      scope: 'token.error-token',
      settings: {
        foreground: '#BE1744',
      },
    },
    {
      name: 'Output/Debug Token - Debug',
      scope: 'token.debug-token',
      settings: {
        foreground: '#3B7E84',
      },
    },
    {
      name: 'Module References',
      scope: 'meta.module-reference',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Escape Characters',
      scope: 'constant.character.escape',
      settings: {
        foreground: '#141414BD',
      },
    },
    {
      name: 'Embedded',
      scope: 'punctuation.section.embedded.begin,punctuation.section.embedded.end',
      settings: {
        foreground: '#3B7E84',
      },
    },
    {
      name: 'Meta Separator',
      scope: 'meta.separator',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Meta Output',
      scope: 'meta.output',
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Links',
      scope: ['constant.other.reference.link'],
      settings: {
        foreground: '#005293',
      },
    },
    {
      name: 'Control Elements',
      scope: 'control.elements',
      settings: {
        foreground: '#CD4500',
      },
    },
    {
      name: 'Delimiter Punctuation',
      scope: 'punctuation.separator.delimiter',
      settings: {
        foreground: '#141414',
      },
    },
    {
      name: 'Edge Constants',
      scope: 'support.constant.edge',
      settings: {
        foreground: '#3B7E84',
      },
    },
  ],
}
