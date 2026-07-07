const vscode = require('vscode');

const THEME_NAME = 'GoLand Exact Dark';
const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
const INTERFACE_DECLARATION = new RegExp(
  `^\\s*type\\s+${IDENTIFIER}(?:\\[[^\\]]+\\])?\\s+interface\\s*\\{`
);

function isThemeActive() {
  return vscode.workspace.getConfiguration('workbench').get('colorTheme') === THEME_NAME;
}

function createRange(line, start, end) {
  return new vscode.Range(new vscode.Position(line, start), new vscode.Position(line, end));
}

function addMatchRanges(lineNumber, text, regex, groupIndex, target) {
  for (const match of text.matchAll(regex)) {
    const whole = match[0];
    const captured = match[groupIndex];
    if (!captured) {
      continue;
    }

    const relative = whole.indexOf(captured);
    const start = match.index + relative;
    target.push(createRange(lineNumber, start, start + captured.length));
  }
}

function importedNameFromPath(pathValue) {
  const parts = pathValue.split('/');
  return parts[parts.length - 1] || pathValue;
}

function stripGoCommentsAndStrings(document) {
  const lines = [];
  let inBlockComment = false;
  let inRawString = false;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    const chars = text.split('');

    for (let index = 0; index < chars.length; index += 1) {
      const current = text[index];
      const next = text[index + 1];

      if (inBlockComment) {
        chars[index] = ' ';
        if (current === '*' && next === '/') {
          chars[index + 1] = ' ';
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (inRawString) {
        chars[index] = ' ';
        if (current === '`') {
          inRawString = false;
        }
        continue;
      }

      if (current === '/' && next === '/') {
        for (let trailing = index; trailing < chars.length; trailing += 1) {
          chars[trailing] = ' ';
        }
        break;
      }

      if (current === '/' && next === '*') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (current === '`') {
        chars[index] = ' ';
        inRawString = true;
        continue;
      }

      if (current === '"' || current === '\'') {
        const quote = current;
        chars[index] = ' ';
        let escaped = false;

        for (let inner = index + 1; inner < chars.length; inner += 1) {
          const innerChar = text[inner];
          chars[inner] = ' ';

          if (escaped) {
            escaped = false;
            continue;
          }

          if (innerChar === '\\') {
            escaped = true;
            continue;
          }

          if (innerChar === quote) {
            index = inner;
            break;
          }
        }
      }
    }

    lines.push(chars.join(''));
  }

  return lines;
}

function collectImportNames(document) {
  const imports = new Set();
  let inImportBlock = false;

  for (let i = 0; i < document.lineCount; i += 1) {
    const text = document.lineAt(i).text;

    if (/^\s*import\s*\(\s*$/.test(text)) {
      inImportBlock = true;
      continue;
    }

    if (inImportBlock && /^\s*\)\s*$/.test(text)) {
      inImportBlock = false;
      continue;
    }

    if (!inImportBlock && !/^\s*import\b/.test(text)) {
      continue;
    }

    const match = text.match(/^\s*(?:import\s+)?(?:(\w+)\s+)?\"([^\"]+)\"/);
    if (!match) {
      continue;
    }

    const alias = match[1];
    const pathValue = match[2];
    if (alias && alias !== '_' && alias !== '.') {
      imports.add(alias);
      continue;
    }

    imports.add(importedNameFromPath(pathValue));
  }

  return imports;
}

function walkInterfaceMethods(document, visit) {
  const sanitizedLines = stripGoCommentsAndStrings(document);
  let interfaceDepth = 0;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = sanitizedLines[lineNumber];
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    const startsInterface = INTERFACE_DECLARATION.test(text);

    if (startsInterface) {
      interfaceDepth += opens - closes;
      continue;
    }

    if (interfaceDepth > 0) {
      const methodMatch = text.match(new RegExp(`^\\s*(${IDENTIFIER})\\s*\\(`));
      if (methodMatch) {
        visit(lineNumber, text, methodMatch[1]);
      }

      interfaceDepth += opens - closes;
    }
  }
}

function collectInterfaceMethods(document) {
  const methods = [];

  walkInterfaceMethods(document, (lineNumber, text, methodName) => {
    const start = text.indexOf(methodName);
    methods.push({ lineNumber, text, methodName, start });
  });

  return methods;
}

function collectSignatureLineNumbers(document) {
  const sanitizedLines = stripGoCommentsAndStrings(document);
  const signatureLines = new Set();
  let interfaceDepth = 0;
  let inFuncSignature = false;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = sanitizedLines[lineNumber];
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;

    if (INTERFACE_DECLARATION.test(text)) {
      interfaceDepth += opens - closes;
      continue;
    }

    if (interfaceDepth > 0) {
      if (new RegExp(`^\\s*${IDENTIFIER}\\s*\\(`).test(text)) {
        signatureLines.add(lineNumber);
      }

      interfaceDepth += opens - closes;
      continue;
    }

    if (/^\s*func\b/.test(text)) {
      inFuncSignature = true;
    }

    if (inFuncSignature) {
      signatureLines.add(lineNumber);
      if (opens > closes || /\{\s*$/.test(text)) {
        inFuncSignature = false;
      }
    }
  }

  return signatureLines;
}

async function updateGoDecorations(editor, decorationTypes) {
  for (const decorationType of Object.values(decorationTypes)) {
    editor.setDecorations(decorationType, []);
  }

  if (!editor || editor.document.languageId !== 'go' || !isThemeActive()) {
    return;
  }

  const document = editor.document;
  const importNames = collectImportNames(document);
  const interfaceMethods = collectInterfaceMethods(document);
  const signatureLines = collectSignatureLineNumbers(document);
  const sanitizedLines = stripGoCommentsAndStrings(document);
  const ranges = {
    packageName: [],
    constName: [],
    packageQualifier: [],
    callName: [],
    memberReference: [],
    interfaceMethod: [],
    signatureType: [],
    packageMemberReference: [],
  };

  let inConstBlock = false;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = sanitizedLines[lineNumber];
    const isSignatureLine = signatureLines.has(lineNumber);

    const packageMatch = text.match(new RegExp(`^\\s*package\\s+(${IDENTIFIER})`));
    if (packageMatch) {
      const name = packageMatch[1];
      const start = text.indexOf(name);
      ranges.packageName.push(createRange(lineNumber, start, start + name.length));
    }

    if (/^\s*const\s*\(\s*$/.test(text)) {
      inConstBlock = true;
      continue;
    }

    if (inConstBlock && /^\s*\)\s*$/.test(text)) {
      inConstBlock = false;
      continue;
    }

    if (inConstBlock) {
      const constMatch = text.match(new RegExp(`^\\s*(${IDENTIFIER})\\b`));
      if (constMatch) {
        const name = constMatch[1];
        const start = text.indexOf(name);
        ranges.constName.push(createRange(lineNumber, start, start + name.length));
      }
    } else {
      const constMatch = text.match(new RegExp(`^\\s*const\\s+(${IDENTIFIER})\\b`));
      if (constMatch) {
        const name = constMatch[1];
        const start = text.indexOf(name);
        ranges.constName.push(createRange(lineNumber, start, start + name.length));
      }
    }

    for (const match of text.matchAll(new RegExp(`\\b(${IDENTIFIER})\\.(${IDENTIFIER})(?=\\s*\\()`, 'g'))) {
      const qualifier = match[1];
      const callee = match[2];
      const baseIndex = match.index;
      const qualifierStart = baseIndex;
      const calleeStart = baseIndex + qualifier.length + 1;

      if (importNames.has(qualifier)) {
        ranges.packageQualifier.push(
          createRange(lineNumber, qualifierStart, qualifierStart + qualifier.length)
        );
      }

      ranges.callName.push(createRange(lineNumber, calleeStart, calleeStart + callee.length));
    }

    for (const match of text.matchAll(new RegExp(`\\b(${IDENTIFIER})\\.(${IDENTIFIER})\\b(?!\\s*\\()`, 'g'))) {
      const qualifier = match[1];
      const member = match[2];
      const baseIndex = match.index;
      const qualifierStart = baseIndex;
      const memberStart = baseIndex + qualifier.length + 1;

      if (importNames.has(qualifier)) {
        ranges.packageQualifier.push(
          createRange(lineNumber, qualifierStart, qualifierStart + qualifier.length)
        );
        if (isSignatureLine) {
          ranges.signatureType.push(
            createRange(lineNumber, memberStart, memberStart + member.length)
          );
        } else {
          ranges.packageMemberReference.push(
            createRange(lineNumber, memberStart, memberStart + member.length)
          );
        }
      } else {
        ranges.memberReference.push(
          createRange(lineNumber, memberStart, memberStart + member.length)
        );
      }
    }

    addMatchRanges(
      lineNumber,
      text,
      new RegExp(`\\bPath\\(\\s*(${IDENTIFIER})\\s*\\)`, 'g'),
      1,
      ranges.constName
    );
  }

  for (const { lineNumber, start, methodName } of interfaceMethods) {
    ranges.interfaceMethod.push(createRange(lineNumber, start, start + methodName.length));
  }

  editor.setDecorations(decorationTypes.packageName, ranges.packageName);
  editor.setDecorations(decorationTypes.constName, ranges.constName);
  editor.setDecorations(decorationTypes.packageQualifier, ranges.packageQualifier);
  editor.setDecorations(decorationTypes.callName, ranges.callName);
  // vysmv
  //editor.setDecorations(decorationTypes.memberReference, ranges.memberReference);
  editor.setDecorations(decorationTypes.interfaceMethod, ranges.interfaceMethod);
  editor.setDecorations(decorationTypes.signatureType, ranges.signatureType);
  editor.setDecorations(decorationTypes.packageMemberReference, ranges.packageMemberReference);
}

function createImplementationInlayHintsProvider() {
  return {
    provideInlayHints(document) {
      if (document.languageId !== 'go' || !isThemeActive()) {
        return [];
      }

      return collectInterfaceMethods(document).map(({ lineNumber, start }) => {
        const label = new vscode.InlayHintLabelPart('↘ impl');
        label.tooltip = 'Go to implementation';
        label.command = {
          title: 'Go to implementation',
          command: 'golandExactTheme.goToImplementationAt',
          arguments: [document.uri, lineNumber, start],
        };

        const hint = new vscode.InlayHint(
          new vscode.Position(lineNumber, 0),
          [label],
          vscode.InlayHintKind.Type
        );
        hint.paddingLeft = true;
        hint.paddingRight = true;
        return hint;
      });
    },
  };
}

function activate(context) {
  const decorationTypes = {
    packageName: vscode.window.createTextEditorDecorationType({
      color: '#a7ac68',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    // VYSMV
    constName: vscode.window.createTextEditorDecorationType({
      color: '#bcbec4',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    packageQualifier: vscode.window.createTextEditorDecorationType({
      color: '#98ab74',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    callName: vscode.window.createTextEditorDecorationType({
      color: '#bea663',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    memberReference: vscode.window.createTextEditorDecorationType({
      color: '#64a3df',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    interfaceMethod: vscode.window.createTextEditorDecorationType({
      color: '#64a3df',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    // VYSMV
    signatureType: vscode.window.createTextEditorDecorationType({
      color: '#c189b7',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    packageMemberReference: vscode.window.createTextEditorDecorationType({
      color: '#c189b7',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
  };

  const revealActiveFile = vscode.commands.registerCommand(
    'golandExactTheme.revealActiveFile',
    async () => {
      await vscode.commands.executeCommand('workbench.files.action.showActiveFileInExplorer');
    }
  );

  const refreshVisibleEditors = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      void updateGoDecorations(editor, decorationTypes);
    }
  };

  const goToImplementationAt = vscode.commands.registerCommand(
    'golandExactTheme.goToImplementationAt',
    async (uri, line, character) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      const position = new vscode.Position(line, character);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));

      const implementations = await vscode.commands.executeCommand(
        'vscode.executeImplementationProvider',
        document.uri,
        position
      );

      if (!Array.isArray(implementations) || implementations.length === 0) {
        void vscode.window.showInformationMessage('No implementations found.');
        return;
      }

      if (implementations.length === 1) {
        const [target] = implementations;
        const targetDocument = await vscode.workspace.openTextDocument(target.uri);
        const targetEditor = await vscode.window.showTextDocument(targetDocument, { preview: false });
        const targetRange =
          target.targetSelectionRange || target.targetRange || target.range;
        if (!targetRange) {
          await vscode.commands.executeCommand('editor.action.peekImplementation');
          return;
        }
        targetEditor.selection = new vscode.Selection(
          targetRange.start,
          targetRange.start
        );
        targetEditor.revealRange(targetRange, vscode.TextEditorRevealType.InCenter);
        return;
      }

      await vscode.commands.executeCommand('editor.action.peekImplementation');
    }
  );

  const inlayHintsProvider = vscode.languages.registerInlayHintsProvider(
    { language: 'go' },
    createImplementationInlayHintsProvider()
  );

  refreshVisibleEditors();

  context.subscriptions.push(
    revealActiveFile,
    goToImplementationAt,
    inlayHintsProvider,
    ...Object.values(decorationTypes),
    vscode.window.onDidChangeActiveTextEditor(() => refreshVisibleEditors()),
    vscode.window.onDidChangeVisibleTextEditors(() => refreshVisibleEditors()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editors = vscode.window.visibleTextEditors.filter(
        (candidate) => candidate.document.uri.toString() === event.document.uri.toString()
      );
      for (const editor of editors) {
        void updateGoDecorations(editor, decorationTypes);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbench.colorTheme') ||
        event.affectsConfiguration('editor.semanticHighlighting.enabled')
      ) {
        refreshVisibleEditors();
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
