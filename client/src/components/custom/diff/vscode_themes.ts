import type { ThemeRegistration } from '@pierre/diffs'

// Flattened from VS Code's bundled 2026 Dark and 2026 Light
// (Visual Studio Code.app/Contents/Resources/app/extensions/theme-defaults/themes), with the themes
// they include merged in: tokenColors as shipped, editor/diff/git colours kept.
// semanticTokenColors dropped.
export const vscodeDark: ThemeRegistration = {
  name: 'vscode-2026-dark',
  displayName: '2026 Dark',
  type: 'dark',
  colors: {
    'editor.background': '#121314',
    'editor.foreground': '#BBBEBF',
    'editorGroupHeader.connectedTabsBackground': '#202122',
    'editorGroupHeader.tabsBorder': '#2A2B2C',
    'editor.inactiveSelectionBackground': '#27678260',
    'editorIndentGuide.background1': '#8384854D',
    'editorIndentGuide.activeBackground1': '#838485',
    'editor.selectionHighlightBackground': '#27678260',
    'editor.findMatchBackground': '#27678290',
    'editorGroup.border': '#FFFFFF17',
    'editorGroupHeader.tabsBackground': '#191A1B',
    'editorGutter.addedBackground': '#72C892',
    'editorGutter.deletedBackground': '#F28772',
    'editorGutter.modifiedBackground': '#0078D4',
    'editorLineNumber.activeForeground': '#BBBEBF',
    'editorLineNumber.foreground': '#858889',
    'editorOverviewRuler.border': '#2A2B2C',
    'editorWidget.background': '#202122',
    'editorStickyScroll.background': '#121314',
    'editorStickyScrollHover.background': '#202122',
    'editorStickyScroll.border': '#2A2B2C',
    'editorCursor.foreground': '#BBBEBF',
    'editor.selectionBackground': '#276782dd',
    'editor.wordHighlightBackground': '#27678250',
    'editor.wordHighlightStrongBackground': '#27678280',
    'editor.findMatchHighlightBackground': '#27678280',
    'editor.findRangeHighlightBackground': '#FFFFFF13',
    'editor.hoverHighlightBackground': '#FFFFFF13',
    'editor.lineHighlightBackground': '#242526',
    'editor.rangeHighlightBackground': '#FFFFFF13',
    'editorLink.activeForeground': '#3a94bc',
    'editorWhitespace.foreground': '#8C8C8C4D',
    'editorRuler.foreground': '#848484',
    'editorCodeLens.foreground': '#8C8C8C',
    'editorBracketMatch.background': '#3994BC55',
    'editorBracketMatch.border': '#2A2B2C',
    'editorWidget.border': '#2A2B2C',
    'editorWidget.foreground': '#bfbfbf',
    'editorSuggestWidget.background': '#202122',
    'editorSuggestWidget.border': '#2A2B2C',
    'editorSuggestWidget.foreground': '#bfbfbf',
    'editorSuggestWidget.highlightForeground': '#bfbfbf',
    'editorSuggestWidget.selectedBackground': '#FFFFFF26',
    'editorSuggestWidget.focusOutline': '#3994BCB3',
    'editorHoverWidget.background': '#202122',
    'editorHoverWidget.border': '#2A2B2C',
    'editorGutter.background': '#121314',
    'diffEditor.insertedLineBackground': '#347d3926',
    'diffEditor.insertedTextBackground': '#57ab5a4d',
    'diffEditor.removedLineBackground': '#c93c3726',
    'diffEditor.removedTextBackground': '#f470674d',
    'editorOverviewRuler.findMatchForeground': '#3a94bc99',
    'editorOverviewRuler.modifiedForeground': '#6ab890',
    'editorOverviewRuler.addedForeground': '#73c991',
    'editorOverviewRuler.deletedForeground': '#f48771',
    'editorOverviewRuler.errorForeground': '#f48771',
    'editorOverviewRuler.warningForeground': '#e5ba7d',
    'gitDecoration.addedResourceForeground': '#73c991',
    'gitDecoration.modifiedResourceForeground': '#e5ba7d',
    'gitDecoration.deletedResourceForeground': '#f48771',
    'gitDecoration.untrackedResourceForeground': '#73c991',
    'gitDecoration.ignoredResourceForeground': '#8C8C8C',
    'gitDecoration.conflictingResourceForeground': '#f48771',
    'gitDecoration.stageModifiedResourceForeground': '#e5ba7d',
    'gitDecoration.stageDeletedResourceForeground': '#f48771',
    'editorCommentsWidget.rangeBackground': '#488FAE26',
    'editorCommentsWidget.rangeActiveBackground': '#488FAE46',
  },
  tokenColors: [
    {
      scope: [
        'meta.embedded',
        'source.groovy.embedded',
        'string meta.image.inline.markdown',
        'variable.legacy.builtin.python',
      ],
      settings: {
        foreground: '#D4D4D4',
      },
    },
    {
      scope: 'emphasis',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      scope: 'strong',
      settings: {
        fontStyle: 'bold',
      },
    },
    {
      scope: 'header',
      settings: {
        foreground: '#000080',
      },
    },
    {
      scope: 'comment',
      settings: {
        foreground: '#6A9955',
      },
    },
    {
      scope: 'constant.language',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: [
        'constant.numeric',
        'variable.other.enummember',
        'keyword.operator.plus.exponent',
        'keyword.operator.minus.exponent',
      ],
      settings: {
        foreground: '#b5cea8',
      },
    },
    {
      scope: 'constant.regexp',
      settings: {
        foreground: '#646695',
      },
    },
    {
      scope: 'entity.name.tag',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: ['entity.name.tag.css', 'entity.name.tag.less'],
      settings: {
        foreground: '#d7ba7d',
      },
    },
    {
      scope: 'entity.other.attribute-name',
      settings: {
        foreground: '#9cdcfe',
      },
    },
    {
      scope: [
        'entity.other.attribute-name.class.css',
        'source.css entity.other.attribute-name.class',
        'entity.other.attribute-name.id.css',
        'entity.other.attribute-name.parent-selector.css',
        'entity.other.attribute-name.parent.less',
        'source.css entity.other.attribute-name.pseudo-class',
        'entity.other.attribute-name.pseudo-element.css',
        'source.css.less entity.other.attribute-name.id',
        'entity.other.attribute-name.scss',
      ],
      settings: {
        foreground: '#d7ba7d',
      },
    },
    {
      scope: 'invalid',
      settings: {
        foreground: '#f44747',
      },
    },
    {
      scope: 'markup.underline',
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      scope: 'markup.bold',
      settings: {
        fontStyle: 'bold',
        foreground: '#569cd6',
      },
    },
    {
      scope: 'markup.heading',
      settings: {
        fontStyle: 'bold',
        foreground: '#569cd6',
      },
    },
    {
      scope: 'markup.italic',
      settings: {
        fontStyle: 'italic',
        foreground: '#C586C0',
      },
    },
    {
      scope: 'markup.strikethrough',
      settings: {
        fontStyle: 'strikethrough',
      },
    },
    {
      scope: 'markup.inserted',
      settings: {
        foreground: '#b5cea8',
      },
    },
    {
      scope: 'markup.deleted',
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      scope: 'markup.changed',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'punctuation.definition.quote.begin.markdown',
      settings: {
        foreground: '#6A9955',
      },
    },
    {
      scope: 'punctuation.definition.list.begin.markdown',
      settings: {
        foreground: '#6796e6',
      },
    },
    {
      scope: 'markup.inline.raw',
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      name: 'brackets of XML/HTML tags',
      scope: 'punctuation.definition.tag',
      settings: {
        foreground: '#808080',
      },
    },
    {
      scope: ['meta.preprocessor', 'entity.name.function.preprocessor'],
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'meta.preprocessor.string',
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      scope: 'meta.preprocessor.numeric',
      settings: {
        foreground: '#b5cea8',
      },
    },
    {
      scope: 'meta.structure.dictionary.key.python',
      settings: {
        foreground: '#9cdcfe',
      },
    },
    {
      scope: 'meta.diff.header',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'storage',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'storage.type',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: ['storage.modifier', 'keyword.operator.noexcept'],
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: ['string', 'meta.embedded.assembly'],
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      scope: 'string.tag',
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      scope: 'string.value',
      settings: {
        foreground: '#ce9178',
      },
    },
    {
      scope: 'string.regexp',
      settings: {
        foreground: '#d16969',
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
        foreground: '#569cd6',
      },
    },
    {
      name: 'Reset JavaScript string interpolation expression',
      scope: ['meta.template.expression'],
      settings: {
        foreground: '#d4d4d4',
      },
    },
    {
      scope: [
        'support.type.vendored.property-name',
        'support.type.property-name',
        'source.css variable',
        'source.coffee.embedded',
      ],
      settings: {
        foreground: '#9cdcfe',
      },
    },
    {
      scope: 'keyword',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'keyword.control',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'keyword.operator',
      settings: {
        foreground: '#d4d4d4',
      },
    },
    {
      scope: [
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.cast',
        'keyword.operator.sizeof',
        'keyword.operator.alignof',
        'keyword.operator.typeid',
        'keyword.operator.alignas',
        'keyword.operator.instanceof',
        'keyword.operator.logical.python',
        'keyword.operator.wordlike',
      ],
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'keyword.other.unit',
      settings: {
        foreground: '#b5cea8',
      },
    },
    {
      scope: ['punctuation.section.embedded.begin.php', 'punctuation.section.embedded.end.php'],
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'support.function.git-rebase',
      settings: {
        foreground: '#9cdcfe',
      },
    },
    {
      scope: 'constant.sha.git-rebase',
      settings: {
        foreground: '#b5cea8',
      },
    },
    {
      name: 'coloring of the Java import and package identifiers',
      scope: [
        'storage.modifier.import.java',
        'variable.language.wildcard.java',
        'storage.modifier.package.java',
      ],
      settings: {
        foreground: '#d4d4d4',
      },
    },
    {
      name: 'this.self',
      scope: 'variable.language',
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      name: 'Function declarations',
      scope: [
        'entity.name.function',
        'support.function',
        'support.constant.handlebars',
        'source.powershell variable.other.member',
        'entity.name.operator.custom-literal',
      ],
      settings: {
        foreground: '#DCDCAA',
      },
    },
    {
      name: 'Types declaration and references',
      scope: [
        'support.class',
        'support.type',
        'entity.name.type',
        'entity.name.namespace',
        'entity.other.attribute',
        'entity.name.scope-resolution',
        'entity.name.class',
        'storage.type.numeric.go',
        'storage.type.byte.go',
        'storage.type.boolean.go',
        'storage.type.string.go',
        'storage.type.uintptr.go',
        'storage.type.error.go',
        'storage.type.rune.go',
        'storage.type.cs',
        'storage.type.generic.cs',
        'storage.type.modifier.cs',
        'storage.type.variable.cs',
        'storage.type.annotation.java',
        'storage.type.generic.java',
        'storage.type.java',
        'storage.type.object.array.java',
        'storage.type.primitive.array.java',
        'storage.type.primitive.java',
        'storage.type.token.java',
        'storage.type.groovy',
        'storage.type.annotation.groovy',
        'storage.type.parameters.groovy',
        'storage.type.generic.groovy',
        'storage.type.object.array.groovy',
        'storage.type.primitive.array.groovy',
        'storage.type.primitive.groovy',
      ],
      settings: {
        foreground: '#4EC9B0',
      },
    },
    {
      name: 'Types declaration and references, TS grammar specific',
      scope: [
        'meta.type.cast.expr',
        'meta.type.new.expr',
        'support.constant.math',
        'support.constant.dom',
        'support.constant.json',
        'entity.other.inherited-class',
        'punctuation.separator.namespace.ruby',
      ],
      settings: {
        foreground: '#4EC9B0',
      },
    },
    {
      name: 'Control flow / Special keywords',
      scope: [
        'keyword.control',
        'source.cpp keyword.operator.new',
        'keyword.operator.delete',
        'keyword.other.using',
        'keyword.other.directive.using',
        'keyword.other.operator',
        'entity.name.operator',
      ],
      settings: {
        foreground: '#C586C0',
      },
    },
    {
      name: 'Variable and parameter name',
      scope: [
        'variable',
        'meta.definition.variable.name',
        'support.variable',
        'entity.name.variable',
        'constant.other.placeholder',
      ],
      settings: {
        foreground: '#9CDCFE',
      },
    },
    {
      name: 'Constants and enums',
      scope: ['variable.other.constant', 'variable.other.enummember'],
      settings: {
        foreground: '#4FC1FF',
      },
    },
    {
      name: 'Object keys, TS grammar specific',
      scope: ['meta.object-literal.key'],
      settings: {
        foreground: '#9CDCFE',
      },
    },
    {
      name: 'CSS property value',
      scope: [
        'support.constant.property-value',
        'support.constant.font-name',
        'support.constant.media-type',
        'support.constant.media',
        'constant.other.color.rgb-value',
        'constant.other.rgb-value',
        'support.constant.color',
      ],
      settings: {
        foreground: '#CE9178',
      },
    },
    {
      name: 'Regular expression groups',
      scope: [
        'punctuation.definition.group.regexp',
        'punctuation.definition.group.assertion.regexp',
        'punctuation.definition.character-class.regexp',
        'punctuation.character.set.begin.regexp',
        'punctuation.character.set.end.regexp',
        'keyword.operator.negation.regexp',
        'support.other.parenthesis.regexp',
      ],
      settings: {
        foreground: '#CE9178',
      },
    },
    {
      scope: [
        'constant.character.character-class.regexp',
        'constant.other.character-class.set.regexp',
        'constant.other.character-class.regexp',
        'constant.character.set.regexp',
      ],
      settings: {
        foreground: '#d16969',
      },
    },
    {
      scope: ['keyword.operator.or.regexp', 'keyword.control.anchor.regexp'],
      settings: {
        foreground: '#DCDCAA',
      },
    },
    {
      scope: 'keyword.operator.quantifier.regexp',
      settings: {
        foreground: '#d7ba7d',
      },
    },
    {
      scope: ['constant.character', 'constant.other.option'],
      settings: {
        foreground: '#569cd6',
      },
    },
    {
      scope: 'constant.character.escape',
      settings: {
        foreground: '#d7ba7d',
      },
    },
    {
      scope: 'entity.name.label',
      settings: {
        foreground: '#C8C8C8',
      },
    },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: {
        foreground: '#8b949e',
      },
    },
    {
      scope: ['constant.other.placeholder', 'constant.character'],
      settings: {
        foreground: '#ff7b72',
      },
    },
    {
      scope: [
        'constant',
        'entity.name.constant',
        'variable.other.constant',
        'variable.other.enummember',
        'variable.language',
        'entity',
      ],
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: ['entity.name', 'meta.export.default', 'meta.definition.variable'],
      settings: {
        foreground: '#ffa657',
      },
    },
    {
      scope: [
        'variable.parameter.function',
        'meta.jsx.children',
        'meta.block',
        'meta.tag.attributes',
        'entity.name.constant',
        'meta.object.member',
        'meta.embedded.expression',
      ],
      settings: {
        foreground: '#c9d1d9',
      },
    },
    {
      scope: 'entity.name.function',
      settings: {
        foreground: '#d2a8ff',
      },
    },
    {
      scope: ['entity.name.tag', 'support.class.component'],
      settings: {
        foreground: '#7ee787',
      },
    },
    {
      scope: 'keyword',
      settings: {
        foreground: '#ff7b72',
      },
    },
    {
      scope: ['storage', 'storage.type'],
      settings: {
        foreground: '#ff7b72',
      },
    },
    {
      scope: ['storage.modifier.package', 'storage.modifier.import', 'storage.type.java'],
      settings: {
        foreground: '#c9d1d9',
      },
    },
    {
      scope: ['string', 'string punctuation.section.embedded source'],
      settings: {
        foreground: '#a5d6ff',
      },
    },
    {
      scope: 'support',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'meta.property-name',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'variable',
      settings: {
        foreground: '#ffa657',
      },
    },
    {
      scope: 'variable.other',
      settings: {
        foreground: '#c9d1d9',
      },
    },
    {
      scope: 'invalid.broken',
      settings: {
        foreground: '#ffa198',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'invalid.deprecated',
      settings: {
        foreground: '#ffa198',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'invalid.illegal',
      settings: {
        foreground: '#ffa198',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'invalid.unimplemented',
      settings: {
        foreground: '#ffa198',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'carriage-return',
      settings: {
        foreground: '#f0f6fc',
        fontStyle: 'italic underline',
      },
    },
    {
      scope: 'message.error',
      settings: {
        foreground: '#ffa198',
      },
    },
    {
      scope: 'string variable',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: ['source.regexp', 'string.regexp'],
      settings: {
        foreground: '#a5d6ff',
      },
    },
    {
      scope: [
        'string.regexp.character-class',
        'string.regexp constant.character.escape',
        'string.regexp source.ruby.embedded',
        'string.regexp string.regexp.arbitrary-repitition',
      ],
      settings: {
        foreground: '#a5d6ff',
      },
    },
    {
      scope: 'string.regexp constant.character.escape',
      settings: {
        foreground: '#7ee787',
        fontStyle: 'bold',
      },
    },
    {
      scope: 'support.constant',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'support.variable',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'support.type.property-name.json',
      settings: {
        foreground: '#7ee787',
      },
    },
    {
      scope: 'meta.module-reference',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'punctuation.definition.list.begin.markdown',
      settings: {
        foreground: '#ffa657',
      },
    },
    {
      scope: ['markup.heading', 'markup.heading entity.name'],
      settings: {
        foreground: '#79c0ff',
        fontStyle: 'bold',
      },
    },
    {
      scope: 'markup.quote',
      settings: {
        foreground: '#7ee787',
      },
    },
    {
      scope: 'markup.italic',
      settings: {
        foreground: '#c9d1d9',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'markup.bold',
      settings: {
        foreground: '#c9d1d9',
        fontStyle: 'bold',
      },
    },
    {
      scope: ['markup.underline'],
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      scope: ['markup.strikethrough'],
      settings: {
        fontStyle: 'strikethrough',
      },
    },
    {
      scope: 'markup.inline.raw',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: ['markup.deleted', 'meta.diff.header.from-file', 'punctuation.definition.deleted'],
      settings: {
        foreground: '#ffa198',
      },
    },
    {
      scope: ['punctuation.section.embedded'],
      settings: {
        foreground: '#ff7b72',
      },
    },
    {
      scope: ['markup.inserted', 'meta.diff.header.to-file', 'punctuation.definition.inserted'],
      settings: {
        foreground: '#7ee787',
      },
    },
    {
      scope: ['markup.changed', 'punctuation.definition.changed'],
      settings: {
        foreground: '#ffa657',
      },
    },
    {
      scope: ['markup.ignored', 'markup.untracked'],
      settings: {
        foreground: '#0d1117',
      },
    },
    {
      scope: 'meta.diff.range',
      settings: {
        foreground: '#d2a8ff',
        fontStyle: 'bold',
      },
    },
    {
      scope: 'meta.diff.header',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: 'meta.separator',
      settings: {
        foreground: '#79c0ff',
        fontStyle: 'bold',
      },
    },
    {
      scope: 'meta.output',
      settings: {
        foreground: '#79c0ff',
      },
    },
    {
      scope: [
        'brackethighlighter.tag',
        'brackethighlighter.curly',
        'brackethighlighter.round',
        'brackethighlighter.square',
        'brackethighlighter.angle',
        'brackethighlighter.quote',
      ],
      settings: {
        foreground: '#8b949e',
      },
    },
    {
      scope: 'brackethighlighter.unmatched',
      settings: {
        foreground: '#ffa198',
      },
    },
    {
      scope: ['constant.other.reference.link', 'string.other.link'],
      settings: {
        foreground: '#a5d6ff',
      },
    },
    {
      scope: 'token.info-token',
      settings: {
        foreground: '#6796E6',
      },
    },
    {
      scope: 'token.warn-token',
      settings: {
        foreground: '#CD9731',
      },
    },
    {
      scope: 'token.error-token',
      settings: {
        foreground: '#F44747',
      },
    },
    {
      scope: 'token.debug-token',
      settings: {
        foreground: '#B267E6',
      },
    },
  ],
}

export const vscodeLight: ThemeRegistration = {
  name: 'vscode-2026-light',
  displayName: '2026 Light',
  type: 'light',
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#202020',
    'editorGroupHeader.connectedTabsBackground': '#EAEAEA',
    'editorGroupHeader.tabsBorder': '#F0F1F2',
    'editor.inactiveSelectionBackground': '#0069CC1A',
    'editorIndentGuide.background1': '#F7F7F740',
    'editorIndentGuide.activeBackground1': '#EEEEEE',
    'editor.selectionHighlightBackground': '#0069CC15',
    'editorSuggestWidget.background': '#FAFAFD',
    'diffEditor.unchangedRegionBackground': '#f8f8f8',
    'editorGroup.border': '#E5E5E5',
    'editorGroupHeader.tabsBackground': '#FAFAFD',
    'editorGutter.addedBackground': '#587c0c',
    'editorGutter.deletedBackground': '#ad0707',
    'editorGutter.modifiedBackground': '#005FB8',
    'editorLineNumber.activeForeground': '#202020',
    'editorLineNumber.foreground': '#606060',
    'editorOverviewRuler.border': '#F0F1F2',
    'editorWidget.background': '#FAFAFD',
    'editorStickyScroll.shadow': '#00000000',
    'editorStickyScrollHover.background': '#F0F0F3',
    'editorStickyScroll.border': '#F0F1F2',
    'editorCursor.foreground': '#202020',
    'editor.selectionBackground': '#0069CC40',
    'editor.wordHighlightBackground': '#0069CC26',
    'editor.wordHighlightStrongBackground': '#0069CC26',
    'editor.findMatchBackground': '#0069CC40',
    'editor.findMatchHighlightBackground': '#0069CC1A',
    'editor.findRangeHighlightBackground': '#00000015',
    'editor.hoverHighlightBackground': '#00000015',
    'editor.lineHighlightBackground': '#EAEAEA40',
    'editor.rangeHighlightBackground': '#00000015',
    'editorLink.activeForeground': '#0069CC',
    'editorWhitespace.foreground': '#60606040',
    'editorRuler.foreground': '#F7F7F7',
    'editorCodeLens.foreground': '#606060',
    'editorBracketMatch.background': '#0069CC40',
    'editorBracketMatch.border': '#F0F1F2',
    'editorWidget.border': '#E4E5E6',
    'editorWidget.foreground': '#202020',
    'editorSuggestWidget.border': '#E4E5E6',
    'editorSuggestWidget.foreground': '#202020',
    'editorSuggestWidget.highlightForeground': '#0069CC',
    'editorSuggestWidget.selectedBackground': '#00000025',
    'editorSuggestWidget.selectedForeground': '#202020',
    'editorSuggestWidget.selectedIconForeground': '#202020',
    'editorSuggestWidget.focusOutline': '#0069CC',
    'editorHoverWidget.background': '#FAFAFD',
    'editorHoverWidget.border': '#E4E5E6',
    'diffEditor.insertedTextBackground': '#587c0c26',
    'diffEditor.removedTextBackground': '#ad070726',
    'editorOverviewRuler.findMatchForeground': '#0069CC99',
    'editorOverviewRuler.modifiedForeground': '#0069CC',
    'editorOverviewRuler.addedForeground': '#587c0c',
    'editorOverviewRuler.deletedForeground': '#ad0707',
    'editorOverviewRuler.errorForeground': '#ad0707',
    'editorOverviewRuler.warningForeground': '#667309',
    'editorGutter.background': '#FFFFFF',
    'gitDecoration.addedResourceForeground': '#587c0c',
    'gitDecoration.modifiedResourceForeground': '#667309',
    'gitDecoration.deletedResourceForeground': '#ad0707',
    'gitDecoration.untrackedResourceForeground': '#587c0c',
    'gitDecoration.ignoredResourceForeground': '#8E8E90',
    'gitDecoration.conflictingResourceForeground': '#ad0707',
    'gitDecoration.stageModifiedResourceForeground': '#667309',
    'gitDecoration.stageDeletedResourceForeground': '#ad0707',
    'editorCommentsWidget.rangeBackground': '#EEF4FB',
    'editorCommentsWidget.rangeActiveBackground': '#E6EDFA',
  },
  tokenColors: [
    {
      scope: [
        'meta.embedded',
        'source.groovy.embedded',
        'string meta.image.inline.markdown',
        'variable.legacy.builtin.python',
      ],
      settings: {
        foreground: '#000000ff',
      },
    },
    {
      scope: 'emphasis',
      settings: {
        fontStyle: 'italic',
      },
    },
    {
      scope: 'strong',
      settings: {
        fontStyle: 'bold',
      },
    },
    {
      scope: 'meta.diff.header',
      settings: {
        foreground: '#000080',
      },
    },
    {
      scope: 'comment',
      settings: {
        foreground: '#008000',
      },
    },
    {
      scope: 'constant.language',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: [
        'constant.numeric',
        'variable.other.enummember',
        'keyword.operator.plus.exponent',
        'keyword.operator.minus.exponent',
      ],
      settings: {
        foreground: '#098658',
      },
    },
    {
      scope: 'constant.regexp',
      settings: {
        foreground: '#811f3f',
      },
    },
    {
      name: 'css tags in selectors, xml tags',
      scope: 'entity.name.tag',
      settings: {
        foreground: '#800000',
      },
    },
    {
      scope: 'entity.name.selector',
      settings: {
        foreground: '#800000',
      },
    },
    {
      scope: 'entity.other.attribute-name',
      settings: {
        foreground: '#e50000',
      },
    },
    {
      scope: [
        'entity.other.attribute-name.class.css',
        'source.css entity.other.attribute-name.class',
        'entity.other.attribute-name.id.css',
        'entity.other.attribute-name.parent-selector.css',
        'entity.other.attribute-name.parent.less',
        'source.css entity.other.attribute-name.pseudo-class',
        'entity.other.attribute-name.pseudo-element.css',
        'source.css.less entity.other.attribute-name.id',
        'entity.other.attribute-name.scss',
      ],
      settings: {
        foreground: '#800000',
      },
    },
    {
      scope: 'invalid',
      settings: {
        foreground: '#cd3131',
      },
    },
    {
      scope: 'markup.underline',
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      scope: 'markup.bold',
      settings: {
        fontStyle: 'bold',
        foreground: '#000080',
      },
    },
    {
      scope: 'markup.heading',
      settings: {
        fontStyle: 'bold',
        foreground: '#800000',
      },
    },
    {
      scope: 'markup.italic',
      settings: {
        fontStyle: 'italic',
        foreground: '#800080',
      },
    },
    {
      scope: 'markup.strikethrough',
      settings: {
        fontStyle: 'strikethrough',
      },
    },
    {
      scope: 'markup.inserted',
      settings: {
        foreground: '#098658',
      },
    },
    {
      scope: 'markup.deleted',
      settings: {
        foreground: '#a31515',
      },
    },
    {
      scope: 'markup.changed',
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: [
        'punctuation.definition.quote.begin.markdown',
        'punctuation.definition.list.begin.markdown',
      ],
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: 'markup.inline.raw',
      settings: {
        foreground: '#800000',
      },
    },
    {
      name: 'brackets of XML/HTML tags',
      scope: 'punctuation.definition.tag',
      settings: {
        foreground: '#800000',
      },
    },
    {
      scope: ['meta.preprocessor', 'entity.name.function.preprocessor'],
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'meta.preprocessor.string',
      settings: {
        foreground: '#a31515',
      },
    },
    {
      scope: 'meta.preprocessor.numeric',
      settings: {
        foreground: '#098658',
      },
    },
    {
      scope: 'meta.structure.dictionary.key.python',
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: 'storage',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'storage.type',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: ['storage.modifier', 'keyword.operator.noexcept'],
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: ['string', 'meta.embedded.assembly'],
      settings: {
        foreground: '#a31515',
      },
    },
    {
      scope: [
        'string.comment.buffered.block.pug',
        'string.quoted.pug',
        'string.interpolated.pug',
        'string.unquoted.plain.in.yaml',
        'string.unquoted.plain.out.yaml',
        'string.unquoted.block.yaml',
        'string.quoted.single.yaml',
        'string.quoted.double.xml',
        'string.quoted.single.xml',
        'string.unquoted.cdata.xml',
        'string.quoted.double.html',
        'string.quoted.single.html',
        'string.unquoted.html',
        'string.quoted.single.handlebars',
        'string.quoted.double.handlebars',
      ],
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'string.regexp',
      settings: {
        foreground: '#811f3f',
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
        foreground: '#0000ff',
      },
    },
    {
      name: 'Reset JavaScript string interpolation expression',
      scope: ['meta.template.expression'],
      settings: {
        foreground: '#000000',
      },
    },
    {
      scope: [
        'support.constant.property-value',
        'support.constant.font-name',
        'support.constant.media-type',
        'support.constant.media',
        'constant.other.color.rgb-value',
        'constant.other.rgb-value',
        'support.constant.color',
      ],
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: [
        'support.type.vendored.property-name',
        'support.type.property-name',
        'source.css variable',
        'source.coffee.embedded',
      ],
      settings: {
        foreground: '#e50000',
      },
    },
    {
      scope: ['support.type.property-name.json'],
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: 'keyword',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'keyword.control',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'keyword.operator',
      settings: {
        foreground: '#000000',
      },
    },
    {
      scope: [
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.cast',
        'keyword.operator.sizeof',
        'keyword.operator.alignof',
        'keyword.operator.typeid',
        'keyword.operator.alignas',
        'keyword.operator.instanceof',
        'keyword.operator.logical.python',
        'keyword.operator.wordlike',
      ],
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'keyword.other.unit',
      settings: {
        foreground: '#098658',
      },
    },
    {
      scope: ['punctuation.section.embedded.begin.php', 'punctuation.section.embedded.end.php'],
      settings: {
        foreground: '#800000',
      },
    },
    {
      scope: 'support.function.git-rebase',
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      scope: 'constant.sha.git-rebase',
      settings: {
        foreground: '#098658',
      },
    },
    {
      name: 'coloring of the Java import and package identifiers',
      scope: [
        'storage.modifier.import.java',
        'variable.language.wildcard.java',
        'storage.modifier.package.java',
      ],
      settings: {
        foreground: '#000000',
      },
    },
    {
      name: 'this.self',
      scope: 'variable.language',
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      name: 'Function declarations',
      scope: [
        'entity.name.function',
        'support.function',
        'support.constant.handlebars',
        'source.powershell variable.other.member',
        'entity.name.operator.custom-literal',
      ],
      settings: {
        foreground: '#795E26',
      },
    },
    {
      name: 'Types declaration and references',
      scope: [
        'support.class',
        'support.type',
        'entity.name.type',
        'entity.name.namespace',
        'entity.other.attribute',
        'entity.name.scope-resolution',
        'entity.name.class',
        'storage.type.numeric.go',
        'storage.type.byte.go',
        'storage.type.boolean.go',
        'storage.type.string.go',
        'storage.type.uintptr.go',
        'storage.type.error.go',
        'storage.type.rune.go',
        'storage.type.cs',
        'storage.type.generic.cs',
        'storage.type.modifier.cs',
        'storage.type.variable.cs',
        'storage.type.annotation.java',
        'storage.type.generic.java',
        'storage.type.java',
        'storage.type.object.array.java',
        'storage.type.primitive.array.java',
        'storage.type.primitive.java',
        'storage.type.token.java',
        'storage.type.groovy',
        'storage.type.annotation.groovy',
        'storage.type.parameters.groovy',
        'storage.type.generic.groovy',
        'storage.type.object.array.groovy',
        'storage.type.primitive.array.groovy',
        'storage.type.primitive.groovy',
      ],
      settings: {
        foreground: '#267f99',
      },
    },
    {
      name: 'Types declaration and references, TS grammar specific',
      scope: [
        'meta.type.cast.expr',
        'meta.type.new.expr',
        'support.constant.math',
        'support.constant.dom',
        'support.constant.json',
        'entity.other.inherited-class',
        'punctuation.separator.namespace.ruby',
      ],
      settings: {
        foreground: '#267f99',
      },
    },
    {
      name: 'Control flow / Special keywords',
      scope: [
        'keyword.control',
        'source.cpp keyword.operator.new',
        'source.cpp keyword.operator.delete',
        'keyword.other.using',
        'keyword.other.directive.using',
        'keyword.other.operator',
        'entity.name.operator',
      ],
      settings: {
        foreground: '#AF00DB',
      },
    },
    {
      name: 'Variable and parameter name',
      scope: [
        'variable',
        'meta.definition.variable.name',
        'support.variable',
        'entity.name.variable',
        'constant.other.placeholder',
      ],
      settings: {
        foreground: '#001080',
      },
    },
    {
      name: 'Constants and enums',
      scope: ['variable.other.constant', 'variable.other.enummember'],
      settings: {
        foreground: '#0070C1',
      },
    },
    {
      name: 'Object keys, TS grammar specific',
      scope: ['meta.object-literal.key'],
      settings: {
        foreground: '#001080',
      },
    },
    {
      name: 'CSS property value',
      scope: [
        'support.constant.property-value',
        'support.constant.font-name',
        'support.constant.media-type',
        'support.constant.media',
        'constant.other.color.rgb-value',
        'constant.other.rgb-value',
        'support.constant.color',
      ],
      settings: {
        foreground: '#0451a5',
      },
    },
    {
      name: 'Regular expression groups',
      scope: [
        'punctuation.definition.group.regexp',
        'punctuation.definition.group.assertion.regexp',
        'punctuation.definition.character-class.regexp',
        'punctuation.character.set.begin.regexp',
        'punctuation.character.set.end.regexp',
        'keyword.operator.negation.regexp',
        'support.other.parenthesis.regexp',
      ],
      settings: {
        foreground: '#d16969',
      },
    },
    {
      scope: [
        'constant.character.character-class.regexp',
        'constant.other.character-class.set.regexp',
        'constant.other.character-class.regexp',
        'constant.character.set.regexp',
      ],
      settings: {
        foreground: '#811f3f',
      },
    },
    {
      scope: 'keyword.operator.quantifier.regexp',
      settings: {
        foreground: '#000000',
      },
    },
    {
      scope: ['keyword.operator.or.regexp', 'keyword.control.anchor.regexp'],
      settings: {
        foreground: '#EE0000',
      },
    },
    {
      scope: ['constant.character', 'constant.other.option'],
      settings: {
        foreground: '#0000ff',
      },
    },
    {
      scope: 'constant.character.escape',
      settings: {
        foreground: '#EE0000',
      },
    },
    {
      scope: 'entity.name.label',
      settings: {
        foreground: '#000000',
      },
    },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: {
        foreground: '#6e7781',
      },
    },
    {
      scope: ['constant.other.placeholder', 'constant.character'],
      settings: {
        foreground: '#cf222e',
      },
    },
    {
      scope: [
        'constant',
        'entity.name.constant',
        'variable.other.constant',
        'variable.other.enummember',
        'variable.language',
        'entity',
      ],
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: ['entity.name', 'meta.export.default', 'meta.definition.variable'],
      settings: {
        foreground: '#953800',
      },
    },
    {
      scope: [
        'variable.parameter.function',
        'meta.jsx.children',
        'meta.block',
        'meta.tag.attributes',
        'entity.name.constant',
        'meta.object.member',
        'meta.embedded.expression',
      ],
      settings: {
        foreground: '#1f2328',
      },
    },
    {
      scope: 'entity.name.function',
      settings: {
        foreground: '#8250df',
      },
    },
    {
      scope: ['entity.name.tag', 'support.class.component'],
      settings: {
        foreground: '#116329',
      },
    },
    {
      scope: 'keyword',
      settings: {
        foreground: '#cf222e',
      },
    },
    {
      scope: ['storage', 'storage.type'],
      settings: {
        foreground: '#cf222e',
      },
    },
    {
      scope: ['storage.modifier.package', 'storage.modifier.import', 'storage.type.java'],
      settings: {
        foreground: '#1f2328',
      },
    },
    {
      scope: ['string', 'string punctuation.section.embedded source'],
      settings: {
        foreground: '#0a3069',
      },
    },
    {
      scope: 'support',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'meta.property-name',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'variable',
      settings: {
        foreground: '#953800',
      },
    },
    {
      scope: 'variable.other',
      settings: {
        foreground: '#1f2328',
      },
    },
    {
      scope: 'invalid.broken',
      settings: {
        fontStyle: 'italic',
        foreground: '#82071e',
      },
    },
    {
      scope: 'invalid.deprecated',
      settings: {
        fontStyle: 'italic',
        foreground: '#82071e',
      },
    },
    {
      scope: 'invalid.illegal',
      settings: {
        fontStyle: 'italic',
        foreground: '#82071e',
      },
    },
    {
      scope: 'invalid.unimplemented',
      settings: {
        fontStyle: 'italic',
        foreground: '#82071e',
      },
    },
    {
      scope: 'carriage-return',
      settings: {
        fontStyle: 'italic underline',
        foreground: '#f6f8fa',
      },
    },
    {
      scope: 'message.error',
      settings: {
        foreground: '#82071e',
      },
    },
    {
      scope: 'string variable',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: ['source.regexp', 'string.regexp'],
      settings: {
        foreground: '#0a3069',
      },
    },
    {
      scope: [
        'string.regexp.character-class',
        'string.regexp constant.character.escape',
        'string.regexp source.ruby.embedded',
        'string.regexp string.regexp.arbitrary-repitition',
      ],
      settings: {
        foreground: '#0a3069',
      },
    },
    {
      scope: 'string.regexp constant.character.escape',
      settings: {
        fontStyle: 'bold',
        foreground: '#116329',
      },
    },
    {
      scope: 'support.constant',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'support.variable',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'support.type.property-name.json',
      settings: {
        foreground: '#116329',
      },
    },
    {
      scope: 'meta.module-reference',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'punctuation.definition.list.begin.markdown',
      settings: {
        foreground: '#953800',
      },
    },
    {
      scope: ['markup.heading', 'markup.heading entity.name'],
      settings: {
        fontStyle: 'bold',
        foreground: '#0550ae',
      },
    },
    {
      scope: 'markup.quote',
      settings: {
        foreground: '#116329',
      },
    },
    {
      scope: 'markup.italic',
      settings: {
        fontStyle: 'italic',
        foreground: '#1f2328',
      },
    },
    {
      scope: 'markup.bold',
      settings: {
        fontStyle: 'bold',
        foreground: '#1f2328',
      },
    },
    {
      scope: ['markup.underline'],
      settings: {
        fontStyle: 'underline',
      },
    },
    {
      scope: ['markup.strikethrough'],
      settings: {
        fontStyle: 'strikethrough',
      },
    },
    {
      scope: 'markup.inline.raw',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: ['markup.deleted', 'meta.diff.header.from-file', 'punctuation.definition.deleted'],
      settings: {
        foreground: '#82071e',
      },
    },
    {
      scope: ['punctuation.section.embedded'],
      settings: {
        foreground: '#cf222e',
      },
    },
    {
      scope: ['markup.inserted', 'meta.diff.header.to-file', 'punctuation.definition.inserted'],
      settings: {
        foreground: '#116329',
      },
    },
    {
      scope: ['markup.changed', 'punctuation.definition.changed'],
      settings: {
        foreground: '#953800',
      },
    },
    {
      scope: ['markup.ignored', 'markup.untracked'],
      settings: {
        foreground: '#eaeef2',
      },
    },
    {
      scope: 'meta.diff.range',
      settings: {
        foreground: '#8250df',
        fontStyle: 'bold',
      },
    },
    {
      scope: 'meta.diff.header',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: 'meta.separator',
      settings: {
        fontStyle: 'bold',
        foreground: '#0550ae',
      },
    },
    {
      scope: 'meta.output',
      settings: {
        foreground: '#0550ae',
      },
    },
    {
      scope: [
        'brackethighlighter.tag',
        'brackethighlighter.curly',
        'brackethighlighter.round',
        'brackethighlighter.square',
        'brackethighlighter.angle',
        'brackethighlighter.quote',
      ],
      settings: {
        foreground: '#57606a',
      },
    },
    {
      scope: 'brackethighlighter.unmatched',
      settings: {
        foreground: '#82071e',
      },
    },
    {
      scope: ['constant.other.reference.link', 'string.other.link'],
      settings: {
        foreground: '#0a3069',
      },
    },
  ],
}
